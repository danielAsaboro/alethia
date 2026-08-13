import { describe, expect, it } from "vitest";

import { evaluateCases, evaluatePairs } from "./metrics";

describe("evaluateCases", () => {
  it("reports verdict accuracy, evidence quality, latency, and confusion", () => {
    const report = evaluateCases([
      {
        expectedVerdict: "SUPPORTED",
        actualVerdict: "SUPPORTED",
        expectedEvidenceIds: ["a", "b"],
        actualEvidenceIds: ["a", "b", "extra"],
        latencyMs: 10,
      },
      {
        expectedVerdict: "UNKNOWN",
        actualVerdict: "NOT_FOUND",
        expectedEvidenceIds: [],
        actualEvidenceIds: [],
        latencyMs: 30,
      },
    ]);

    expect(report).toEqual({
      cases: 2,
      verdictAccuracy: 0.5,
      evidenceRecall: 1,
      invalidExtraEvidenceRate: 1 / 3,
      p50LatencyMs: 10,
      p95LatencyMs: 30,
      confusion: {
        SUPPORTED: { SUPPORTED: 1 },
        UNKNOWN: { NOT_FOUND: 1 },
      },
    });
  });

  it("uses honest zero-denominator conventions", () => {
    expect(evaluateCases([])).toMatchObject({
      cases: 0,
      verdictAccuracy: 0,
      evidenceRecall: null,
      invalidExtraEvidenceRate: null,
    });
  });
});

describe("evaluatePairs", () => {
  it("reports pairwise precision, recall, and f1", () => {
    expect(
      evaluatePairs(
        new Set(["a|b", "c|d"]),
        new Set(["a|b", "x|y"]),
      ),
    ).toEqual({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    });
  });
});
