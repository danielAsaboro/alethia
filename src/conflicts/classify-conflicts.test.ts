import { describe, expect, it } from "vitest";

import type { Claim } from "@/domain/ontology";
import { classifyClaimPair } from "./classify-conflicts";

function claim(input: {
  id: string;
  value: string;
  sourceObjectId?: string;
  predicate?: string;
  validFrom?: string;
  validTo?: string;
}): Claim {
  return {
    id: input.id,
    subjectEntityId: "entity_pool",
    predicate: input.predicate ?? "reserved_percent",
    object: { kind: "literal", value: input.value },
    sourceObjectId: input.sourceObjectId ?? "source_jira",
    sourceSystem: "jira",
    extractionMethod: "qvac",
    extractorVersion: "qvac:test",
    validFrom: input.validFrom,
    validTo: input.validTo,
  };
}

describe("classifyClaimPair", () => {
  it("separates same-source equivalent observations from cross-source corroboration", () => {
    const left = claim({ id: "claim_left", value: "30%" });
    expect(
      classifyClaimPair(left, claim({ id: "claim_right", value: "30%" })),
    ).toMatchObject({ kind: "equivalent_observation" });
    expect(
      classifyClaimPair(
        left,
        claim({
          id: "claim_drive",
          value: "30%",
          sourceObjectId: "source_drive",
        }),
      ),
    ).toMatchObject({ kind: "corroboration" });
  });

  it("classifies incompatible overlapping values as a contradiction", () => {
    expect(
      classifyClaimPair(
        claim({ id: "claim_20", value: "20%" }),
        claim({ id: "claim_30", value: "30%", sourceObjectId: "source_drive" }),
      ),
    ).toMatchObject({ kind: "contradiction" });
  });

  it("classifies non-overlapping versions as supersession", () => {
    expect(
      classifyClaimPair(
        claim({
          id: "claim_old",
          value: "20%",
          validFrom: "2026-03-01T00:00:00Z",
          validTo: "2026-03-18T23:59:59Z",
        }),
        claim({
          id: "claim_new",
          value: "30%",
          sourceObjectId: "source_drive",
          validFrom: "2026-03-19T00:00:00Z",
        }),
      ),
    ).toMatchObject({ kind: "supersession", winningClaimId: "claim_new" });
  });

  it("keeps predicates incomparable when ontology alignment is unresolved", () => {
    expect(
      classifyClaimPair(
        claim({ id: "claim_owner", value: "Maya", predicate: "owner" }),
        claim({
          id: "claim_assignee",
          value: "Maya",
          predicate: "assignee",
          sourceObjectId: "source_linear",
        }),
        { predicatesAligned: false },
      ),
    ).toMatchObject({ kind: "incomparable", reason: "alignment_unresolved" });
  });
});
