import { describe, expect, it } from "vitest";

import { buildCausalArms, type CausalCaseInput } from "./causal-arms";

const input: CausalCaseInput = {
  caseId: "qst_development_1",
  question: "What setting is current?",
  documents: [
    { id: "current", sourceSystem: "drive", text: "Applied setting is thirty percent.", tokenCount: 6, lifecycle: "current" },
    { id: "retired", sourceSystem: "jira", text: "Proposal setting is twenty percent.", tokenCount: 6, lifecycle: "superseded" },
    { id: "distractor-a", sourceSystem: "drive", text: "Rollout monitoring remains enabled.", tokenCount: 6, lifecycle: "unknown" },
    { id: "distractor-b", sourceSystem: "jira", text: "Owners meet after deployment.", tokenCount: 6, lifecycle: "unknown" },
  ],
  retrievalDocumentIds: ["current", "retired"],
  graph: {
    currentDocumentIds: ["current"],
    supersededDocumentIds: ["retired"],
    conflictDocumentIds: ["current", "retired"],
    verdict: "SUPPORTED",
    hydraQueryIds: ["query-live-1"],
  },
};

describe("buildCausalArms", () => {
  it("builds all ten required arms over one immutable experiment contract", () => {
    expect(buildCausalArms(input, "seed-1").map((arm) => arm.id)).toEqual([
      "plain_retrieval",
      "random_matched_removal",
      "superseded_evidence_removal",
      "current_evidence_pinning",
      "full_sourcetruce_grounding",
      "prompt_only_conflict_reconciliation",
      "no_hydra",
      "no_identity_resolution",
      "no_ontology_alignment",
      "no_conflict_policy",
    ]);
  });

  it("keeps real-document and token budgets equal without leaking the selected answer", () => {
    const arms = buildCausalArms(input, "seed-1");
    expect(new Set(arms.map((arm) => arm.documents.length))).toEqual(new Set([2]));
    expect(new Set(arms.map((arm) => arm.contextTokenCount))).toEqual(new Set([12]));
    expect(arms.every((arm) => arm.documents.every((document) => input.documents.some((candidate) => candidate.id === document.id)))).toBe(true);
    expect(JSON.stringify(arms.map((arm) => arm.promptMetadata))).not.toContain("thirty percent");
    expect(arms.every((arm) => !arm.promptMetadata.selectedAnswer && !arm.promptMetadata.expectedVerdict)).toBe(true);
    expect(JSON.stringify(arms)).not.toMatch(/expectedEvidence|goldAnswer|answerFacts/);
  });

  it("replaces removed evidence with deterministic real distractors", () => {
    const arms = buildCausalArms(input, "seed-1");
    const removal = arms.find((arm) => arm.id === "superseded_evidence_removal")!;
    expect(removal.documents.map((document) => document.id)).toEqual(["current", "distractor-b"]);
    expect(removal.removedDocumentIds).toEqual(["retired"]);
    expect(removal.replacementDocumentIds).toEqual(["distractor-b"]);
  });
});
