import { describe, expect, it } from "vitest";

import { parseEvaluationJudgeResponse } from "./evaluation-judge";

describe("parseEvaluationJudgeResponse", () => {
  it("accepts the exact answer-evaluation schema", () => {
    expect(
      parseEvaluationJudgeResponse(
        '{"correct":true,"completeness":0.5,"satisfiedFactIndexes":[0,2],"reason":"Two of four facts are present."}',
        4,
      ),
    ).toEqual({
      correct: true,
      completeness: 0.5,
      satisfiedFactIndexes: [0, 2],
      reason: "Two of four facts are present.",
    });
  });

  it.each([
    ['{"correct":true,"completeness":1,"satisfiedFactIndexes":[0],"reason":"ok","extra":1}', 1],
    ['{"correct":"yes","completeness":1,"satisfiedFactIndexes":[0],"reason":"ok"}', 1],
    ['{"correct":true,"completeness":1.1,"satisfiedFactIndexes":[0],"reason":"ok"}', 1],
    ['{"correct":true,"completeness":1,"satisfiedFactIndexes":[1],"reason":"ok"}', 1],
    ['{"correct":true,"completeness":1,"satisfiedFactIndexes":[0,0],"reason":"ok"}', 1],
    ['```json\n{"correct":true,"completeness":1,"satisfiedFactIndexes":[0],"reason":"ok"}\n```', 1],
  ])("rejects malformed or semantically invalid output", (response, facts) => {
    expect(() => parseEvaluationJudgeResponse(response, facts)).toThrow(
      /judge response/i,
    );
  });
});
