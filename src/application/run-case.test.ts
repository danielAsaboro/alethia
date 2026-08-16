import { describe, expect, it } from "vitest";
import type { CaseRepository } from "./run-case";
import { runJudgeCase } from "./run-case";
import type { HydraPathProof, NativePathInput } from "@/hydra/client";

function nativePath(input: NativePathInput): HydraPathProof {
  const relationshipType = input.relationshipTypes[0] ?? "ASSERTS";
  return {
    operation: "algo.SPpaths",
    consistency: "strong",
    queryId: `query-${input.sourceLogicalId}-${input.targetLogicalId}`,
    readEpoch: 123,
    bookmark: "sgk:test:123",
    latencyMs: 4.2,
    roundTrips: 1,
    pathLength: 1,
    pathWeight: 1,
    pathCost: 0,
    nodes: [
      { id: 1, labels: ["Entity"], logicalId: input.sourceLogicalId },
      { id: 2, labels: ["SourceObject"], logicalId: input.targetLogicalId },
    ],
    relationships: [
      {
        id: 3,
        type: relationshipType,
        sourceId: 1,
        targetId: 2,
        logicalId: "edge-test",
      },
    ],
  };
}

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
    findClaimEvidence: async () => [],
    findTeamMemberEvidence: async () => [],
    findNativePaths: async (input) => [nativePath(input)],
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

  it("returns the 120-second winner when updated guidance supersedes 180 seconds", async () => {
    const resolved = repository();
    resolved.findObservationEvidence = async () => [
      { claimLogicalId: "c120", observationLogicalId: "o120", sourceLogicalId: "s120", predicate: "conflict_answer", object: { kind: "literal", value: "120 seconds" }, method: "qvac", extractorVersion: "v", evidenceQuote: "Handshake tokens now default to TTL 120 seconds (was 180s)", sourceSystem: "confluence", sourceNativeId: "doc-a" },
      { claimLogicalId: "c180", observationLogicalId: "o180", sourceLogicalId: "s180", predicate: "conflict_answer", object: { kind: "literal", value: "180 seconds" }, method: "qvac", extractorVersion: "v", evidenceQuote: "handshake tokens are single-use and TTL-limited (default 180s)", sourceSystem: "google_drive", sourceNativeId: "doc-b" },
    ];
    resolved.findConflictDecision = async () => ({
      conflictId: "conflict_524fe5b1878058507b93dd95",
      resolution: "left",
      claimIds: ["c120", "c180"],
      leftClaimId: "c120",
      rightClaimId: "c180",
      policyId: "policy_grounded_supersession_v2",
      winningClaimId: "c120",
    });

    const workspace = await runJudgeCase("handshake-ttl-conflict", resolved);
    expect(workspace.verdict).toBe("SUPPORTED");
    expect(workspace.answer).toMatch(/120/);
    expect(workspace.evidence).toHaveLength(2);
    expect(workspace.decision.status).toBe("resolved");
  });

  it("returns DISPUTED from the canonical equal-lifecycle tool-signal conflict", async () => {
    const disputed = repository();
    disputed.findObservationEvidence = async () => [
      { claimLogicalId: "claim-left", observationLogicalId: "observation-left-old", sourceLogicalId: "source-left", predicate: "conflict_answer", object: { kind: "literal", value: "flag required" }, method: "qvac", extractorVersion: "qvac:v7", evidenceQuote: "The public flag is required.", sourceSystem: "github", sourceNativeId: "doc-left" },
      { claimLogicalId: "claim-left", observationLogicalId: "observation-left-current", sourceLogicalId: "source-left", predicate: "conflict_answer", object: { kind: "literal", value: "flag required" }, method: "qvac", extractorVersion: "qvac:v17", evidenceQuote: "The public flag is required.", sourceSystem: "github", sourceNativeId: "doc-left" },
      { claimLogicalId: "claim-right", observationLogicalId: "observation-right", sourceLogicalId: "source-right", predicate: "conflict_answer", object: { kind: "literal", value: "no public flag" }, method: "qvac", extractorVersion: "qvac:v17", evidenceQuote: "There is no public flag.", sourceSystem: "google_drive", sourceNativeId: "doc-right" },
    ];
    disputed.findConflictDecision = async () => ({
      conflictId: "conflict_2687f02efba6edbe2d92be93",
      resolution: "unresolved",
      claimIds: ["claim-left", "claim-right"],
      leftClaimId: "claim-left",
      rightClaimId: "claim-right",
    });

    const workspace = await runJudgeCase("tool-signal-disputed", disputed);

    expect(workspace.verdict).toBe("DISPUTED");
    expect(workspace.evidence).toHaveLength(2);
    expect(workspace.evidence.map((item) => item.value)).toEqual(["flag required", "no public flag"]);
    expect(workspace.decision).toMatchObject({ status: "unresolved", policy: undefined });
    expect(workspace.counterfactual).toMatch(/supersession|authority/i);
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

  it("answers a simple role lookup from canonical Hydra claim evidence", async () => {
    const live = repository();
    live.findClaimEvidence = async (_entityId, predicate) =>
      predicate === "has_role"
        ? [
            {
              claimLogicalId: "claim-role",
              predicate,
              object: { kind: "literal", value: "Software Engineer" },
              sourceLogicalId: "source_object_fa63884437348a11c9312fb9",
              sourceSystem: "herb",
              sourceNativeId: "eid_01942cf0",
            },
          ]
        : [];

    const workspace = await runJudgeCase("charlie-davis-role", live);
    expect(workspace).toMatchObject({
      verdict: "SUPPORTED",
      answer: "Software Engineer",
      graphProof: {
        operation: "algo.SPpaths",
        consistency: "strong",
        roundTrips: 1,
      },
    });
    expect(workspace.evidence).toEqual([
      {
        source: "herb · eid_01942cf0",
        quote: "Software Engineer",
        value: "Software Engineer",
      },
    ]);
  });

  it("answers the ActionGenie multi-hop lane from 66 distinct members", async () => {
    const live = repository();
    live.findTeamMemberEvidence = async () =>
      Array.from({ length: 66 }, (_, index) => ({
        entityLogicalId: `member-${index}`,
        displayName: `Member ${String(index + 1).padStart(2, "0")}`,
        relationshipClaimId: `team-claim-${index}`,
        nameClaimId: `name-claim-${index}`,
        sourceLogicalId: `source-${index}`,
        sourceSystem: "herb",
        sourceNativeId: `eid-${index}`,
      }));
    live.findCoverageSlices = async () => [
      {
        id: "coverage-herb-products",
        ingestionRunId: "run-herb",
        sourceSystem: "herb",
        objectType: "product",
        predicateFamilies: ["identity", "product_team"],
        contentScope: "metadata",
        status: "complete",
      },
    ];

    const workspace = await runJudgeCase("actiongenie-team", live);
    expect(workspace.verdict).toBe("SUPPORTED");
    expect(workspace.answer).toMatch(/^66 team members:/);
    expect(workspace.evidence).toHaveLength(66);
    expect(workspace.graphProof.path).toContain("source-0");
  });

  it("returns NOT_FOUND for Lagos only when location coverage is complete", async () => {
    const live = repository();
    live.findClaimEvidence = async (_entityId, predicate) =>
      predicate === "located_in"
        ? [
            {
              claimLogicalId: "claim-remote",
              predicate,
              object: { kind: "literal", value: "Remote" },
              sourceLogicalId: "source_object_fa63884437348a11c9312fb9",
              sourceSystem: "herb",
              sourceNativeId: "eid_01942cf0",
              extractionMethod: "deterministic",
              extractorVersion: "herb-structural-v1",
            },
          ]
        : [];
    live.findCoverageSlices = async () => [
      {
        id: "coverage-herb-employees",
        ingestionRunId: "run-herb",
        sourceSystem: "herb",
        objectType: "employee",
        predicateFamilies: ["identity", "employment", "role", "location"],
        contentScope: "metadata",
        status: "complete",
      },
    ];

    const workspace = await runJudgeCase("charlie-davis-lagos", live);
    expect(workspace).toMatchObject({
      verdict: "NOT_FOUND",
      answer: "No Lagos location was found in the completed employee-location coverage.",
      coverage: { sufficient: true },
    });
    expect(workspace.evidence).toEqual([
      {
        source: "herb · eid_01942cf0",
        quote: "Related location evidence: Remote",
        value: "Remote",
      },
    ]);
  });

  it("changes the Lagos verdict to UNKNOWN when location coverage is incomplete", async () => {
    const incomplete = repository();
    incomplete.findClaimEvidence = async () => [];
    incomplete.findCoverageSlices = async () => [
      {
        id: "coverage-herb-employees",
        ingestionRunId: "run-herb",
        sourceSystem: "herb",
        objectType: "employee",
        predicateFamilies: ["identity", "employment", "role"],
        contentScope: "metadata",
        status: "complete",
      },
    ];

    const workspace = await runJudgeCase("charlie-davis-lagos", incomplete);
    expect(workspace.verdict).toBe("UNKNOWN");
    expect(workspace.coverage.sufficient).toBe(false);
  });

  it("fails closed when a required native graph proof is absent", async () => {
    const corrupt = repository();
    corrupt.findClaimEvidence = async () => [
      {
        claimLogicalId: "claim-role",
        predicate: "has_role",
        object: { kind: "literal", value: "Software Engineer" },
        sourceLogicalId: "source_object_fa63884437348a11c9312fb9",
        sourceSystem: "herb",
        sourceNativeId: "eid_01942cf0",
        extractionMethod: "deterministic",
        extractorVersion: "herb-structural-v1",
      },
    ];
    corrupt.findNativePaths = async () => [];

    await expect(runJudgeCase("charlie-davis-role", corrupt)).rejects.toThrow(
      /native path/i,
    );
  });
});
