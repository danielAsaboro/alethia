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
});
