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
      signals: expect.arrayContaining([{ kind: "external_id_exact", normalizedValue: "eid-42" }]),
      constraints: ["same_identity_namespace"],
      confidence: 1,
      algorithmVersion: "resolver-v2",
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
        { kind: "verified_email_exact", normalizedValue: "sam.rivera@example.com" },
      ],
      constraints: ["cross_source_email_allowed"],
      confidence: 1,
    });
  });

  it("records a name-only match as pending and refuses to auto-merge it", () => {
    const result = resolveEntities([
      sourceObject("source_a", [nameIdentity()]),
      sourceObject("source_b", [nameIdentity()]),
    ]);

    expect(result.entities).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({
      status: "pending",
      signals: [{ kind: "name_similarity", normalizedValue: "sam rivera" }],
      constraints: ["name_not_unique"],
      confidence: 0.35,
    });
  });

  it("accepts an explicit verified account link across different names", () => {
    const result = resolveEntities([
      sourceObject("gmail_sam", [nameIdentity("S. Ratnaparkhi")], "gmail"),
      sourceObject("slack_soham", [nameIdentity("Soham")], "slack"),
    ], { verifiedLinks: [{ leftSourceObjectId: "gmail_sam", rightSourceObjectId: "slack_soham", reference: "profile-link-1" }] });

    expect(result.entities).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ status: "accepted", signals: [{ kind: "verified_account_link" }] });
  });

  it("rejects a similar name with conflicting verified email and employee ID", () => {
    const identity = (id: string, email: string): IdentityObservation[] => [
      { kind: "name", value: "Sam Lee", normalizedValue: "sam lee", sourceSystem: "hr" },
      { kind: "email", value: email, normalizedValue: email, sourceSystem: "hr" },
      { kind: "external_id", value: id, normalizedValue: id, sourceSystem: "hr" },
    ];
    const result = resolveEntities([
      sourceObject("sam_1", identity("e-1", "sam1@example.com"), "hr"),
      sourceObject("sam_2", identity("e-2", "sam2@example.com"), "hr"),
    ]);

    expect(result.entities).toHaveLength(2);
    expect(result.decisions[0]).toMatchObject({
      status: "rejected",
      constraints: expect.arrayContaining(["verified_email_conflict", "employee_id_conflict"]),
    });
  });

  it("blocks a transitive merge that would violate a cluster employee ID", () => {
    const email = (value: string, sourceSystem: string): IdentityObservation => ({ kind: "email", value, normalizedValue: value, sourceSystem });
    const employee = (value: string): IdentityObservation => ({ kind: "external_id", value, normalizedValue: value, sourceSystem: "hr" });
    const result = resolveEntities([
      sourceObject("a", [employee("e-1"), email("sam@example.com", "hr")], "hr"),
      sourceObject("b", [email("sam@example.com", "slack")], "slack"),
      sourceObject("c", [employee("e-2"), email("sam@example.com", "hr")], "hr"),
    ]);

    expect(result.entities).toHaveLength(2);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      status: "rejected",
      constraints: expect.arrayContaining(["cluster_identity_conflict"]),
    }));
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
      algorithmVersion: "resolver-v2",
    });
  });
});
