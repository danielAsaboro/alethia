import { describe, expect, it } from "vitest";

import { scoreCausalResults } from "./causal-score";

describe("scoreCausalResults", () => {
  it("reports answer, evidence, abstention, retirement, parity, latency, and Hydra metrics by arm", () => {
    const report = scoreCausalResults({
      rows: [{
        caseId: "q1", armId: "plain_retrieval", status: "completed", latencyMs: 12,
        contextDocumentCount: 2, contextTokenBudget: 10, hydraQueryCount: 0,
        modelInputTokens: 101,
        response: { answer: "old", verdict: "SUPPORTED", evidenceDocumentIds: ["old-doc", "extra"] },
      }, {
        caseId: "q1", armId: "full_sourcetruce_grounding", status: "completed", latencyMs: 8,
        contextDocumentCount: 2, contextTokenBudget: 10, hydraQueryCount: 2,
        modelInputTokens: 103,
        response: { answer: "new", verdict: "SUPPORTED", evidenceDocumentIds: ["new-doc"] },
      }],
      labels: [{ caseId: "q1", expectedDocumentIds: ["new-doc"] }],
      judgments: [{ caseId: "q1", answer: "old", correct: false, completeness: 0 }, { caseId: "q1", answer: "new", correct: true, completeness: 1 }],
      retiredValues: new Map([["q1", ["old"]]]),
    });

    expect(report.arms.plain_retrieval).toMatchObject({
      attempts: 1, answerCorrectness: 0, evidencePrecision: 0, evidenceRecall: 0,
      invalidExtraEvidence: 2, unsupportedAnswerRate: 1, incorrectAbstentions: 0,
      retiredValuePresentedAsCurrent: 1, hydraQueryCount: 0,
    });
    expect(report.arms.full_sourcetruce_grounding).toMatchObject({
      attempts: 1, answerCorrectness: 1, evidencePrecision: 1, evidenceRecall: 1,
      invalidExtraEvidence: 0, unsupportedAnswerRate: 0, currentValueSurfaced: 1,
      hydraQueryCount: 2,
    });
    expect(report.parity).toEqual({ contextDocumentCounts: [2], contextTokenBudgets: [10], wordBudgetPassed: true, modelInputTokenCounts: [101, 103], modelInputTokenPassed: false });
  });
});
