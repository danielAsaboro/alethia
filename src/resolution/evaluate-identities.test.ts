import { describe, expect, it } from "vitest";

import type { ResolutionDecision } from "./resolve-entities";
import { evaluateIdentityDecisions } from "./evaluate-identities";

function decision(
  id: string,
  pair: [string, string],
  status: ResolutionDecision["status"],
  signal: "external_id_exact" | "name_similarity",
  constraints: string[] = [],
): ResolutionDecision {
  return {
    id,
    status,
    candidateSourceObjectIds: pair,
    signals: [{ kind: signal, normalizedValue: id }],
    constraints,
    confidence: status === "accepted" ? 1 : 0,
    algorithmVersion: "resolver-v2",
    inputDigest: id.padEnd(64, "0"),
  };
}

describe("evaluateIdentityDecisions", () => {
  it("measures balanced positive and negative pair quality without dropping errors", () => {
    const report = evaluateIdentityDecisions([
      decision("tp", ["a", "b"], "accepted", "external_id_exact"),
      decision("fn", ["c", "d"], "rejected", "external_id_exact", ["employee_id_conflict"]),
      decision("fp", ["e", "f"], "accepted", "name_similarity"),
      decision("tn", ["g", "h"], "rejected", "name_similarity", ["employee_id_conflict"]),
    ], [
      { leftSourceObjectId: "a", rightSourceObjectId: "b", sameEntity: true, stratum: "exact_identifier", rationale: "audited positive" },
      { leftSourceObjectId: "c", rightSourceObjectId: "d", sameEntity: true, stratum: "exact_identifier", rationale: "audited positive" },
      { leftSourceObjectId: "e", rightSourceObjectId: "f", sameEntity: false, stratum: "name_similarity", rationale: "audited negative" },
      { leftSourceObjectId: "g", rightSourceObjectId: "h", sameEntity: false, stratum: "conflicting_verified_identifiers", rationale: "audited negative" },
    ]);

    expect(report.pairwise).toMatchObject({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      trueNegative: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      falseMerges: 1,
      falseSplits: 1,
    });
    expect(report.decisions).toEqual({ accepted: 2, rejected: 2, pending: 0, reversed: 0 });
    expect(report.byStratum.exact_identifier.recall).toBe(0.5);
    expect(report.byStratum.conflicting_verified_identifiers.falseMerges).toBe(0);
    expect(report.byStratum.conflicting_verified_identifiers.accuracy).toBe(1);
    expect(report.bCubed).toBeNull();
  });

  it("computes B-cubed only when every audited object has a cluster label", () => {
    const report = evaluateIdentityDecisions([
      decision("ab", ["a", "b"], "accepted", "external_id_exact"),
      decision("cd", ["c", "d"], "rejected", "name_similarity"),
    ], [
      { leftSourceObjectId: "a", rightSourceObjectId: "b", sameEntity: true, stratum: "exact_identifier", rationale: "same", leftClusterId: "person-1", rightClusterId: "person-1" },
      { leftSourceObjectId: "c", rightSourceObjectId: "d", sameEntity: false, stratum: "name_similarity", rationale: "different", leftClusterId: "person-2", rightClusterId: "person-3" },
    ]);

    expect(report.bCubed).toEqual({ precision: 1, recall: 1, f1: 1, objects: 4 });
  });
});
