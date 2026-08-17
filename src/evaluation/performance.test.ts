import { describe, expect, it } from "vitest";

import { summarizeTrials } from "./performance";
import { parseMeasurePerformanceArgs } from "@/cli/measure-performance";

describe("summarizeTrials", () => {
  it("reports honest min, median, nearest-rank p95, and max", () => {
    expect(summarizeTrials([10, 20, 30, 40])).toEqual({
      count: 4,
      min: 10,
      median: 25,
      p95: 40,
      p99: 40,
      max: 40,
    });
  });

  it("rejects empty, negative, and non-finite samples", () => {
    expect(() => summarizeTrials([])).toThrow(/sample/i);
    expect(() => summarizeTrials([1, -1])).toThrow(/sample/i);
    expect(() => summarizeTrials([Number.NaN])).toThrow(/sample/i);
  });
});

describe("parseMeasurePerformanceArgs", () => {
  it("requires a real ingestion ledger and repeated trials", () => {
    expect(parseMeasurePerformanceArgs([
      "--ledger", "ledger.json",
      "--trials", "3",
      "--output", "performance.json",
    ])).toEqual({ ledger: "ledger.json", trials: 3, output: "performance.json" });
    expect(() => parseMeasurePerformanceArgs([
      "--ledger", "ledger.json",
      "--trials", "1",
      "--output", "performance.json",
    ])).toThrow(/trials/i);
  });
});
