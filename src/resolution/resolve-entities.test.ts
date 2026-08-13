import { describe, expect, it } from "vitest";

import type {
  IdentityObservation,
  NormalizedSourceObject,
} from "@/ingestion/source-adapter";
import { resolveEntities, reverseResolution } from "./resolve-entities";

function sourceObject(
  id: string,
  identities: IdentityObservation[],
  sourceSystem = "herb",
): NormalizedSourceObject {
  return {
    id,
    sourceSystem,
    sourceObjectType: "employee",
    sourceNativeId: `${sourceSystem}_${id}`,
    sourcePath: `/private/${sourceSystem}.json`,
    contentScope: "metadata",
    payloadDigest: id.padEnd(64, "0"),
    fields: { name: "Sam Rivera" },
    identities,
  };
}

const externalIdentity = (sourceSystem: string): IdentityObservation => ({
  kind: "external_id",
  value: "EID-42",
  normalizedValue: "eid-42",
  sourceSystem,
});

const nameIdentity = (value = "Sam Rivera"): IdentityObservation => ({
  kind: "name",
  value,
  normalizedValue: value.toLowerCase(),
  sourceSystem: "herb",
});

describe("resolveEntities", () => {
  it("merges an exact external ID only inside the same identity namespace", () => {
    const result = resolveEntities([
      sourceObject("source_a", [externalIdentity("herb"), nameIdentity()]),
      sourceObject("source_b", [externalIdentity("herb"), nameIdentity()]),
    ]);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].sourceObjectIds).toEqual(["source_a", "source_b"]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      status: "accepted",
      candidateSourceObjectIds: ["source_a", "source_b"],
      signals: [{ kind: "external_id_exact", normalizedValue: "eid-42" }],
      constraints: ["same_identity_namespace"],
      confidence: 1,
      algorithmVersion: "resolver-v1",
    });
  });

  it("merges an exact normalized email across source systems", () => {
    const email = (sourceSystem: string): IdentityObservation => ({
      kind: "email",
      value: "Sam.Rivera@Example.com",
      normalizedValue: "sam.rivera@example.com",
      sourceSystem,
    });
    const result = resolveEntities([
      sourceObject("source_gmail", [email("gmail")], "gmail"),
      sourceObject("source_slack", [email("slack")], "slack"),
    ]);

    expect(result.entities).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      status: "accepted",
      signals: [
        { kind: "email_exact", normalizedValue: "sam.rivera@example.com" },
      ],
      constraints: ["cross_source_email_allowed"],
      confidence: 0.99,
    });
  });

  it("records a name-only match but refuses to auto-merge it", () => {
    const result = resolveEntities([
      sourceObject("source_a", [nameIdentity()]),
      sourceObject("source_b", [nameIdentity()]),
    ]);

    expect(result.entities).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({
      status: "rejected",
      signals: [{ kind: "name_exact", normalizedValue: "sam rivera" }],
      constraints: ["name_not_unique"],
      confidence: 0.35,
    });
  });

  it("reverses a merge with a superseding decision instead of deleting history", () => {
    const objects = [
      sourceObject("source_a", [externalIdentity("herb")]),
      sourceObject("source_b", [externalIdentity("herb")]),
    ];
    const original = resolveEntities(objects);
    const reversed = reverseResolution(
      objects,
      original,
      original.decisions[0].id,
    );

    expect(reversed.entities).toHaveLength(2);
    expect(reversed.decisions).toHaveLength(2);
    expect(reversed.decisions[1]).toMatchObject({
      status: "reversed",
      supersedesDecisionId: original.decisions[0].id,
      candidateSourceObjectIds: ["source_a", "source_b"],
      algorithmVersion: "resolver-v1",
    });
  });
});
