import { describe, expect, it } from "vitest";

import type { ClaimObservation } from "@/domain/evidence";
import { consolidateClaims } from "./consolidate-claims";
import { groupAnswerValues } from "./group-answers";

function observation(id: string, sourceObjectId: string): ClaimObservation {
  return {
    id,
    claimCandidate: {
      id: `candidate_${id}`,
      subjectEntityId: "entity_charlie",
      predicate: "has_role",
      object: { kind: "literal", value: "Software Engineer" },
      sourceObjectId,
      sourceSystem: "herb",
      extractionMethod: "deterministic",
      extractorVersion: "test",
    },
    method: "deterministic",
    extractorVersion: "test",
  };
}

describe("groupAnswerValues", () => {
  it("groups equivalent values while retaining distinct claims and sources", () => {
    const bundle = consolidateClaims([
      observation("observation_employee", "source_employee"),
      observation("observation_profile", "source_profile"),
    ]);

    expect(groupAnswerValues(bundle)).toEqual([
      {
        valueLabel: "Software Engineer",
        claimIds: expect.arrayContaining(bundle.claims.map((claim) => claim.id)),
        observationIds: ["observation_employee", "observation_profile"],
        sourceObjectIds: ["source_employee", "source_profile"],
        claimCount: 2,
        observationCount: 2,
      },
    ]);
  });
});
