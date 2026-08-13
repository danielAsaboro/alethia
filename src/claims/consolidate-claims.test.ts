import { describe, expect, it } from "vitest";

import type { ClaimObservation } from "@/domain/evidence";
import { consolidateClaims } from "./consolidate-claims";

const observation = (
  method: "deterministic" | "qvac",
  value: string,
  evidenceQuote: string,
): ClaimObservation => ({
  id: `observation_${method}`,
  claimCandidate: {
    id: `candidate_${method}`,
    subjectEntityId: "entity_charlie",
    predicate: "has_role",
    object: { kind: "literal", value },
    sourceObjectId: "source_herb_charlie",
    sourceSystem: "herb",
    extractionMethod: method,
    extractorVersion: `${method}:test`,
  },
  evidenceQuote,
  method,
  extractorVersion: `${method}:test`,
});

describe("consolidateClaims", () => {
  it("consolidates deterministic and QVAC observations of the same source claim", () => {
    const result = consolidateClaims([
      observation("deterministic", "Software Engineer", "role field"),
      observation(
        "qvac",
        "Software Engineer",
        "works as Software Engineer",
      ),
    ]);

    expect(result.claims).toHaveLength(1);
    expect(result.observations).toHaveLength(2);
    expect(result.claims[0].observationIds).toHaveLength(2);
    expect(result.corroborations).toEqual([]);
  });

  it("records corroboration only across distinct source objects", () => {
    const first = observation("deterministic", "Software Engineer", "role");
    const second = {
      ...observation("qvac", "Software Engineer", "profile text"),
      id: "observation_profile",
      claimCandidate: {
        ...observation("qvac", "Software Engineer", "profile text")
          .claimCandidate,
        sourceObjectId: "source_profile_charlie",
      },
    };
    const result = consolidateClaims([first, second]);

    expect(result.claims).toHaveLength(2);
    expect(result.corroborations).toEqual([
      {
        leftClaimId: result.claims[0].id,
        rightClaimId: result.claims[1].id,
      },
    ]);
  });
});
