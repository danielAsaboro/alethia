import { describe, expect, it } from "vitest";

import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import type { ResolutionDecision } from "./resolve-entities";
import { buildIdentityReviewSet } from "./build-identity-review-set";

function record(id: string, employeeId: string, name: string): NormalizedSourceObject {
  return {
    id,
    sourceSystem: "herb",
    sourceObjectType: "employee",
    sourceNativeId: `${employeeId}:${id}`,
    sourcePath: "employee.json",
    contentScope: "metadata",
    payloadDigest: id.padEnd(64, "0"),
    fields: { employeeId, name, role: "Engineer", org: "slack", location: "Remote" },
    identities: [{
      kind: "external_id",
      value: employeeId,
      normalizedValue: employeeId,
      sourceSystem: "herb:person",
    }],
  };
}

function decision(id: string, pair: [string, string], status: ResolutionDecision["status"]): ResolutionDecision {
  return {
    id,
    status,
    candidateSourceObjectIds: pair,
    signals: [{ kind: "name_similarity", normalizedValue: "shared name" }],
    constraints: status === "rejected" ? ["employee_id_conflict"] : ["same_identity_namespace"],
    confidence: status === "accepted" ? 1 : 0,
    algorithmVersion: "resolver-v2",
    inputDigest: id.padEnd(64, "0"),
  };
}

describe("buildIdentityReviewSet", () => {
  it("exports deterministic source facts without resolver verdicts or gold labels", () => {
    const records = [
      record("a", "e-1", "Alex Lee"), record("b", "e-1", "Alex Lee"),
      record("c", "e-2", "Sam Kim"), record("d", "e-3", "Sam Kim"),
      record("e", "e-4", "Taylor Ray"), record("f", "e-5", "Taylor Ray"),
    ];
    const decisions = [
      decision("accepted", ["a", "b"], "accepted"),
      decision("rejected-1", ["c", "d"], "rejected"),
      decision("rejected-2", ["e", "f"], "rejected"),
    ];

    const first = buildIdentityReviewSet(records, decisions, 3);
    const second = buildIdentityReviewSet([...records].reverse(), [...decisions].reverse(), 3);

    expect(first).toEqual(second);
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates[0]).toMatchObject({
      left: {
        sourceObjectId: "a",
        employeeId: "e-1",
        externalIdentifiers: [{ namespace: "herb:person", value: "e-1" }],
        name: "Alex Lee",
      },
      right: {
        sourceObjectId: "b",
        employeeId: "e-1",
        externalIdentifiers: [{ namespace: "herb:person", value: "e-1" }],
        name: "Alex Lee",
      },
    });
    expect(JSON.stringify(first)).not.toMatch(/expected|predicted|sameEntity|status|signal|constraint|confidence/i);
    expect(first.runtimeDecisionDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses an undersized candidate pool instead of simulating scale", () => {
    expect(() => buildIdentityReviewSet(
      [record("a", "e-1", "Alex"), record("b", "e-1", "Alex")],
      [decision("one", ["a", "b"], "accepted")],
      2,
    )).toThrow(/only 1 real resolver candidates/);
  });
});
