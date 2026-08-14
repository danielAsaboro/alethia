import { describe, expect, it } from "vitest";

import type { CounterfactualInput } from "./explain-change";
import { explainVerdictChange } from "./explain-change";

describe("explainVerdictChange", () => {
  it("requires an authority policy to resolve an ungoverned dispute", () => {
    const input: CounterfactualInput = {
      verdict: "DISPUTED",
      controllingClaimIds: [],
      unresolvedConflictIds: ["conflict_launch_date"],
      applicablePolicyIds: [],
      missingCoverage: [],
      unresolvedIdentityDecisionIds: [],
    };
    expect(explainVerdictChange(input)).toContainEqual(
      expect.objectContaining({
        kind: "authority_policy_missing",
        referenceIds: ["conflict_launch_date"],
      }),
    );
  });

  it("names the exact coverage slices required to turn UNKNOWN into an answer", () => {
    const input: CounterfactualInput = {
      verdict: "UNKNOWN",
      controllingClaimIds: [],
      unresolvedConflictIds: [],
      applicablePolicyIds: [],
      missingCoverage: [
        {
          sourceSystem: "google_drive",
          objectType: "document",
          predicateFamily: "launch_date",
          reason: "slice_missing",
        },
      ],
      unresolvedIdentityDecisionIds: [],
    };
    expect(explainVerdictChange(input)).toContainEqual(
      expect.objectContaining({
        kind: "coverage_slice_required",
        sourceSystem: "google_drive",
        predicateFamily: "launch_date",
      }),
    );
  });

  it("states the bounded supersession condition for a supported verdict", () => {
    expect(
      explainVerdictChange({
        verdict: "SUPPORTED",
        controllingClaimIds: ["claim_current"],
        unresolvedConflictIds: [],
        applicablePolicyIds: ["policy_lifecycle"],
        missingCoverage: [],
        unresolvedIdentityDecisionIds: [],
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "controlling_claim_superseded",
        referenceIds: ["claim_current", "policy_lifecycle"],
      }),
    );
  });

  it("states that later in-scope ingestion can change bounded NOT_FOUND", () => {
    expect(
      explainVerdictChange({
        verdict: "NOT_FOUND",
        controllingClaimIds: [],
        unresolvedConflictIds: [],
        applicablePolicyIds: [],
        missingCoverage: [],
        completedCoverageSliceIds: ["coverage_lunch_complete"],
        unresolvedIdentityDecisionIds: [],
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "later_in_scope_evidence",
        referenceIds: ["coverage_lunch_complete"],
      }),
    );
  });
});
