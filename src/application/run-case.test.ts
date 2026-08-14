import { describe, expect, it } from "vitest";
import type { CaseRepository } from "./run-case";
import { runJudgeCase } from "./run-case";

function repository(): CaseRepository {
  return {
    findObservationEvidence: async () => [
      { claimLogicalId: "c20", observationLogicalId: "o20", sourceLogicalId: "s20", predicate: "conflict_answer", object: { kind: "literal", value: "20%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "proposal 20%", sourceSystem: "jira", sourceNativeId: "j1" },
      { claimLogicalId: "c30", observationLogicalId: "o30", sourceLogicalId: "s30", predicate: "conflict_answer", object: { kind: "literal", value: "30%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "applied 30%", sourceSystem: "google_drive", sourceNativeId: "d1" },
    ],
    findConflictDecision: async () => ({ conflictId: "f", resolution: "right", claimIds: ["c20", "c30"], policyId: "p", winningClaimId: "c30" }),
    findAlignmentDecisions: async () => [],
    findIdentityDecision: async () => null,
    entityExists: async () => true,
    findCoverageSlices: async () => [],
  };
}

describe("runJudgeCase", () => {
  it("builds a conflict workspace from Hydra evidence and the winning path", async () => {
    const workspace = await runJudgeCase("streamly-credit-conflict", repository());
    expect(workspace).toMatchObject({ verdict: "SUPPORTED", answer: "30%" });
    expect(workspace.evidence).toHaveLength(2);
    expect(workspace.traversal).toContain("HAS_OBSERVATION");
    expect(workspace.ablation.result).toContain("disputed");
  });

  it("fails closed when required Hydra evidence is missing", async () => {
    const missing = repository();
    missing.findConflictDecision = async () => null;
    await expect(runJudgeCase("streamly-credit-conflict", missing)).rejects.toThrow(/not ready/);
  });

  it("derives source-aware mapping names from accepted Hydra decisions", async () => {
    const aligned = repository();
    aligned.findAlignmentDecisions = async (termId) => [{
      decisionId: `decision_${termId}`,
      status: "accepted",
      sourceTermId: termId,
      ontologyTermId: termId.includes("390378") ? "ontology_file_owner" : "ontology_opportunity_owner",
      ontologyTermName: termId.includes("390378") ? "FILE_OWNER" : "OPPORTUNITY_OWNER",
      relationship: "MAPS_TO",
      reason: "exact_registry_rule",
    }];

    const workspace = await runJudgeCase("owner-is-not-owner", aligned);
    expect(workspace.answer).toBe("No. FILE_OWNER and OPPORTUNITY_OWNER are distinct ontology relations.");
  });

  it("fails closed unless the identity rejection and hard blocker are present", async () => {
    const unsafe = repository();
    unsafe.findIdentityDecision = async () => ({
      decisionId: "d",
      status: "accepted",
      sourceObjectIds: ["s1", "s2"],
      signalKinds: ["name_similarity"],
      constraintKinds: [],
    });

    await expect(runJudgeCase("david-taylor-collision", unsafe)).rejects.toThrow(/not ready/);
  });
});
