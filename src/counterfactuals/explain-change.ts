import { stableId } from "@/domain/ids";
import type { CoverageGap, Verdict } from "@/domain/ontology";

export interface CounterfactualInput {
  verdict: Verdict;
  controllingClaimIds: string[];
  unresolvedConflictIds: string[];
  applicablePolicyIds: string[];
  missingCoverage: CoverageGap[];
  completedCoverageSliceIds?: string[];
  unresolvedIdentityDecisionIds: string[];
}

export interface CounterfactualRequirement {
  id: string;
  kind:
    | "authority_policy_missing"
    | "higher_authority_evidence"
    | "coverage_slice_required"
    | "identity_decision_required"
    | "controlling_claim_superseded"
    | "later_in_scope_evidence";
  summary: string;
  referenceIds: string[];
  sourceSystem?: string;
  objectType?: string;
  predicateFamily?: string;
}

function requirement(
  value: Omit<CounterfactualRequirement, "id">,
): CounterfactualRequirement {
  return { id: stableId("counterfactual", value), ...value };
}

export function explainVerdictChange(
  input: CounterfactualInput,
): CounterfactualRequirement[] {
  const requirements: CounterfactualRequirement[] = [];

  if (input.verdict === "DISPUTED") {
    for (const conflictId of input.unresolvedConflictIds) {
      if (input.applicablePolicyIds.length === 0) {
        requirements.push(
          requirement({
            kind: "authority_policy_missing",
            summary:
              "A governing authority policy for this conflict is required before either claim can control.",
            referenceIds: [conflictId],
          }),
        );
      } else {
        requirements.push(
          requirement({
            kind: "higher_authority_evidence",
            summary:
              "Grounded evidence that is decisive under an applicable policy would resolve this conflict.",
            referenceIds: [conflictId, ...input.applicablePolicyIds].sort(),
          }),
        );
      }
    }
  }

  for (const gap of input.missingCoverage) {
    requirements.push(
      requirement({
        kind: "coverage_slice_required",
        summary: `Complete the required coverage for ${gap.sourceSystem}/${gap.objectType}/${gap.predicateFamily}.`,
        referenceIds: [],
        sourceSystem: gap.sourceSystem,
        objectType: gap.objectType,
        predicateFamily: gap.predicateFamily,
      }),
    );
  }

  for (const decisionId of input.unresolvedIdentityDecisionIds) {
    requirements.push(
      requirement({
        kind: "identity_decision_required",
        summary:
          "The unresolved identity decision must be resolved before evidence can be assigned to one entity.",
        referenceIds: [decisionId],
      }),
    );
  }

  if (input.verdict === "SUPPORTED" && input.controllingClaimIds.length > 0) {
    requirements.push(
      requirement({
        kind: "controlling_claim_superseded",
        summary:
          "A later grounded claim that wins under the cited policy, or invalidation of the controlling claim, would change this verdict.",
        referenceIds: [
          ...input.controllingClaimIds,
          ...input.applicablePolicyIds,
        ].sort(),
      }),
    );
  }

  if (input.verdict === "NOT_FOUND") {
    requirements.push(
      requirement({
        kind: "later_in_scope_evidence",
        summary:
          "A later ingestion into the same bounded coverage slices containing the requested fact would change this verdict.",
        referenceIds: [...(input.completedCoverageSliceIds ?? [])].sort(),
      }),
    );
  }

  return requirements.sort((left, right) => left.id.localeCompare(right.id));
}
