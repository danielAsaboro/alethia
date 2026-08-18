import { describe, expect, it } from "vitest";

import { indexCausalJudgmentCache } from "./causal-judgment-cache";

describe("indexCausalJudgmentCache", () => {
  it("indexes both successful judgments and failed attempts by normalized answer", () => {
    const cache = indexCausalJudgmentCache({
      judgments: [{ caseId: "q1", answer: "  Current   VALUE ", correct: true, completeness: 1, rawOutput: "{}", latencyMs: 4 }],
      judgeFailures: [{ caseId: "q2", answer: "Timed OUT", error: "timeout", rawOutput: null }],
    });

    expect(cache.judgments.get("q1\0current value")).toMatchObject({ caseId: "q1", reused: true });
    expect(cache.failures.get("q2\0timed out")).toEqual({ caseId: "q2", answer: "Timed OUT", error: "timeout", rawOutput: null, reused: true });
  });
});
