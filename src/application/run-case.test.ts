import { describe, expect, it } from "vitest";
import type { CaseRepository } from "./run-case";
import { runJudgeCase } from "./run-case";

function repository(): CaseRepository {
  return {
    findObservationEvidence: async () => [
      { claimLogicalId: "c20", observationLogicalId: "o20", sourceLogicalId: "s20", predicate: "conflict_answer", object: { kind: "literal", value: "20%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "proposal 20%", sourceSystem: "jira", sourceNativeId: "j1" },
      { claimLogicalId: "c30", observationLogicalId: "o30", sourceLogicalId: "s30", predicate: "conflict_answer", object: { kind: "literal", value: "30%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "applied 30%", sourceSystem: "google_drive", sourceNativeId: "d1" },
    ],
    findConflictDecision: async () => ({ conflictId: "conflict_ba37432da763e77f186ba072", resolution: "right", claimIds: ["c20", "c30"], leftClaimId: "c20", rightClaimId: "c30", policyId: "p", winningClaimId: "c30" }),
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

  it("returns DISPUTED when Hydra has competing observations and no winning claim", async () => {
    const disputed = repository();
    disputed.findObservationEvidence = async () => [
      { claimLogicalId: "c120", observationLogicalId: "o120", sourceLogicalId: "s120", predicate: "conflict_answer", object: { kind: "literal", value: "120 seconds" }, method: "qvac", extractorVersion: "v", evidenceQuote: "Handshake tokens now default to TTL 120 seconds (was 180s)", sourceSystem: "confluence", sourceNativeId: "doc-a" },
      { claimLogicalId: "c180", observationLogicalId: "o180", sourceLogicalId: "s180", predicate: "conflict_answer", object: { kind: "literal", value: "180 seconds" }, method: "qvac", extractorVersion: "v", evidenceQuote: "handshake tokens are single-use and TTL-limited (default 180s)", sourceSystem: "google_drive", sourceNativeId: "doc-b" },
    ];
    disputed.findConflictDecision = async () => ({
      conflictId: "conflict_f83ddaaaa1d7e8f3623f4e8b",
      resolution: "unresolved",
      claimIds: ["c120", "c180"],
      leftClaimId: "c120",
      rightClaimId: "c180",
    });

    const workspace = await runJudgeCase("handshake-ttl-conflict", disputed);
    expect(workspace.verdict).toBe("DISPUTED");
    expect(workspace.answer).toMatch(/120|180/);
    expect(workspace.evidence).toHaveLength(2);
    expect(workspace.decision.status).toBe("unresolved");
  });

  it("fails closed when the observation path omits a claim considered by the conflict", async () => {
    const incomplete = repository();
    incomplete.findObservationEvidence = async () => [
      { claimLogicalId: "c20", observationLogicalId: "o20-a", sourceLogicalId: "s20-a", predicate: "conflict_answer", object: { kind: "literal", value: "20%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "proposal 20%", sourceSystem: "jira", sourceNativeId: "j1" },
      { claimLogicalId: "c20", observationLogicalId: "o20-b", sourceLogicalId: "s20-b", predicate: "conflict_answer", object: { kind: "literal", value: "20%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "proposal remains 20%", sourceSystem: "confluence", sourceNativeId: "c1" },
    ];

    await expect(runJudgeCase("streamly-credit-conflict", incomplete)).rejects.toThrow(/not ready/);
  });

  it("scopes entity observations to the two claims considered by the conflict", async () => {
    const crossWired = repository();
    crossWired.findObservationEvidence = async () => [
      ...(await repository().findObservationEvidence("ignored")),
      { claimLogicalId: "unrelated", observationLogicalId: "o-other", sourceLogicalId: "s-other", predicate: "conflict_answer", object: { kind: "literal", value: "40%" }, method: "qvac", extractorVersion: "v", evidenceQuote: "another pool uses 40%", sourceSystem: "slack", sourceNativeId: "other" },
    ];

    const workspace = await runJudgeCase("streamly-credit-conflict", crossWired);
    expect(workspace).toMatchObject({ verdict: "SUPPORTED", answer: "30%" });
    expect(workspace.evidence).toHaveLength(2);
    expect(workspace.evidence.map((item) => item.value)).not.toContain("40%");
  });

  it("fails closed on an impossible unresolved decision with a winner and policy", async () => {
    const impossible = repository();
    impossible.findConflictDecision = async () => ({
      conflictId: "conflict_ba37432da763e77f186ba072",
      resolution: "unresolved",
      claimIds: ["c20", "c30"],
      leftClaimId: "c20",
      rightClaimId: "c30",
      policyId: "p",
      winningClaimId: "c30",
    });

    await expect(runJudgeCase("streamly-credit-conflict", impossible)).rejects.toThrow(/not ready/);
  });

  it("fails closed when a resolved conflict has no policy path", async () => {
    const policyless = repository();
    policyless.findConflictDecision = async () => ({
      conflictId: "conflict_ba37432da763e77f186ba072",
      resolution: "right",
      claimIds: ["c20", "c30"],
      leftClaimId: "c20",
      rightClaimId: "c30",
      winningClaimId: "c30",
    });

    await expect(runJudgeCase("streamly-credit-conflict", policyless)).rejects.toThrow(/not ready/);
  });

  it("fails closed when the resolution side disagrees with the winning claim", async () => {
    const inconsistent = repository();
    inconsistent.findConflictDecision = async () => ({
      conflictId: "conflict_ba37432da763e77f186ba072",
      resolution: "left",
      claimIds: ["c20", "c30"],
      leftClaimId: "c20",
      rightClaimId: "c30",
      policyId: "p",
      winningClaimId: "c30",
    });

    await expect(runJudgeCase("streamly-credit-conflict", inconsistent)).rejects.toThrow(/not ready/);
  });

  it("fails closed when Hydra returns a different conflict than the one requested", async () => {
    const wrongConflict = repository();
    wrongConflict.findConflictDecision = async () => ({
      conflictId: "conflict_from_another_case",
      resolution: "right",
      claimIds: ["c20", "c30"],
      leftClaimId: "c20",
      rightClaimId: "c30",
      policyId: "p",
      winningClaimId: "c30",
    });

    await expect(runJudgeCase("streamly-credit-conflict", wrongConflict)).rejects.toThrow(/not ready/);
  });

  it("fails closed when Hydra omits the conflict side identities", async () => {
    const sideLess = repository();
    sideLess.findConflictDecision = async () => ({
      conflictId: "conflict_ba37432da763e77f186ba072",
      resolution: "right",
      claimIds: ["c20", "c30"],
      policyId: "p",
      winningClaimId: "c30",
    });

    await expect(runJudgeCase("streamly-credit-conflict", sideLess)).rejects.toThrow(/not ready/);
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
