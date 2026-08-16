import { describe, expect, it } from "vitest";

import type { AlignmentDecision } from "./alignment-policy";
import { evaluateAlignmentDecisions } from "./evaluate-alignments";

function decision(id: string, status: AlignmentDecision["status"]): AlignmentDecision {
  return {
    id,
    sourceTermId: `source-${id}`,
    candidateOntologyTermId: `target-${id}`,
    evidenceObservationIds: [`observation-${id}`],
    constraints: [],
    status,
    reason: status === "accepted" ? "exact_registry_rule" : status === "rejected" ? "domain_range_mismatch" : "no_exact_registry_rule",
    inputDigest: id.padEnd(64, "0"),
  };
}

describe("evaluateAlignmentDecisions", () => {
  it("scores accepted and rejected mappings and retains each error", () => {
    const decisions = [
      decision("accepted-correct", "accepted"),
      decision("accepted-wrong", "rejected"),
      decision("rejected-wrong", "accepted"),
      decision("rejected-correct", "rejected"),
    ];
    const labels = decisions.map((item, index) => ({
      sourceTermId: item.sourceTermId,
      candidateOntologyTermId: item.candidateOntologyTermId,
      expectedStatus: index < 2 ? "accepted" as const : "rejected" as const,
      stratum: index < 2 ? "contextual_mapping" as const : "domain_range_hard_negative" as const,
      rationale: "audited mapping",
    }));

    const report = evaluateAlignmentDecisions(decisions, labels);

    expect(report.accuracy).toBe(0.5);
    expect(report.confusion).toEqual({
      accepted: { accepted: 1, rejected: 1 },
      rejected: { accepted: 1, rejected: 1 },
    });
    expect(report.byExpectedStatus.accepted.accuracy).toBe(0.5);
    expect(report.byExpectedStatus.rejected.accuracy).toBe(0.5);
    expect(report.errors).toHaveLength(2);
  });

  it("scores same-surface/different-meaning and different-surface/equivalent strata independently", () => {
    const sameSurface = decision("same-surface", "rejected");
    const differentSurface = decision("different-surface", "accepted");
    const report = evaluateAlignmentDecisions([sameSurface, differentSurface], [
      { sourceTermId: sameSurface.sourceTermId, candidateOntologyTermId: sameSurface.candidateOntologyTermId, expectedStatus: "rejected", stratum: "same_surface_different_meaning", rationale: "owner has a different domain" },
      { sourceTermId: differentSurface.sourceTermId, candidateOntologyTermId: differentSurface.candidateOntologyTermId, expectedStatus: "accepted", stratum: "different_surface_equivalent_meaning", rationale: "audited semantic equivalence" },
    ]);

    expect(report.byStratum.same_surface_different_meaning.accuracy).toBe(1);
    expect(report.byStratum.different_surface_equivalent_meaning.accuracy).toBe(1);
  });
});
