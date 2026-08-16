import { describe, expect, it } from "vitest";

import type { GraphObservationEvidence } from "@/hydra/client";
import { latestObservationsByClaim } from "./measure-policy-ablations";

function observation(
  claimLogicalId: string,
  observationLogicalId: string,
  extractorVersion: string,
): GraphObservationEvidence {
  return {
    claimLogicalId,
    observationLogicalId,
    sourceLogicalId: `source_${observationLogicalId}`,
    predicate: "conflict_answer",
    object: { kind: "literal", value: claimLogicalId },
    method: "qvac",
    extractorVersion,
    evidenceQuote: claimLogicalId,
    sourceSystem: "google_drive",
    sourceNativeId: `native_${observationLogicalId}`,
  };
}

describe("policy ablation observation replay", () => {
  it("selects one newest extraction for each considered claim", () => {
    const rows = [
      observation("claim_left", "observation_left_v7", "qvac:model:v7"),
      observation("claim_right", "observation_right_v15", "qvac:model:v15"),
      observation("claim_left", "observation_left_v17", "qvac:model:v17"),
      observation("claim_unrelated", "observation_other_v99", "qvac:model:v99"),
      observation("claim_right", "observation_right_v17", "qvac:model:v17"),
    ];

    expect(
      latestObservationsByClaim(rows, ["claim_left", "claim_right"]),
    ).toMatchObject([
      { observationLogicalId: "observation_left_v17" },
      { observationLogicalId: "observation_right_v17" },
    ]);
  });
});
