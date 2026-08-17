import { describe, expect, it } from "vitest";

import {
  CAUSAL_PROMPT_VERSION,
  buildCausalGenerationRequest,
  validateCausalGenerationResponse,
} from "./causal-generation";
import type { CausalArm } from "./causal-arms";

const arm: CausalArm = {
  id: "full_sourcetruce_grounding",
  caseId: "case-1",
  question: "What is current?",
  documents: [{ id: "doc-1", sourceSystem: "drive", text: "The applied limit is 30%.", tokenCount: 6, lifecycle: "current" }],
  contextTokenCount: 6,
  removedDocumentIds: ["doc-2"],
  replacementDocumentIds: ["doc-3"],
  hydraQueryIds: ["query-1"],
  promptMetadata: { reconcileConflicts: false, graphGrounded: true, identityResolution: true, ontologyAlignment: true, conflictPolicy: true },
};

describe("causal generation contract", () => {
  it("uses one versioned prompt template without graph-selected answers or expected verdicts", () => {
    const request = buildCausalGenerationRequest(arm);
    expect(request.promptVersion).toBe(CAUSAL_PROMPT_VERSION);
    expect(request.system).not.toContain("30%");
    expect(request.prompt).not.toMatch(/selectedAnswer|expectedVerdict|gold|answerFacts/);
    expect(request.settings).toEqual({ temperature: 0, maxOutputTokens: 220 });
  });

  it("does not expose graph lifecycle labels to non-Hydra arms", () => {
    const plain = { ...arm, id: "plain_retrieval" as const, hydraQueryIds: [], promptMetadata: { ...arm.promptMetadata, graphGrounded: false } };
    expect(JSON.parse(buildCausalGenerationRequest(plain).prompt).documents[0].lifecycle).toBe("unknown");
    expect(JSON.parse(buildCausalGenerationRequest(arm).prompt).documents[0].lifecycle).toBe("current");
  });

  it("adds only neutral budget padding when token parity requires it", () => {
    const prompt = JSON.parse(buildCausalGenerationRequest(arm, 3).prompt);
    expect(prompt.budgetPadding).toBe("pad pad pad");
    expect(() => buildCausalGenerationRequest(arm, -1)).toThrow(/padding/i);
  });

  it("accepts only grounded structured answers with known evidence IDs", () => {
    expect(validateCausalGenerationResponse(
      '{"answer":"30%","verdict":"SUPPORTED","evidenceDocumentIds":["doc-1"]}',
      arm,
    )).toEqual({ answer: "30%", verdict: "SUPPORTED", evidenceDocumentIds: ["doc-1"] });
    expect(() => validateCausalGenerationResponse(
      '{"answer":"30%","verdict":"SUPPORTED","evidenceDocumentIds":["unknown"]}',
      arm,
    )).toThrow(/unknown evidence/i);
  });

  it("requires an empty answer for abstaining verdicts", () => {
    expect(() => validateCausalGenerationResponse(
      '{"answer":"guess","verdict":"UNKNOWN","evidenceDocumentIds":[]}',
      arm,
    )).toThrow(/empty answer/i);
  });
});
