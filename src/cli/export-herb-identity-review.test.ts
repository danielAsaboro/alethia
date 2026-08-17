import { describe, expect, it } from "vitest";

import { parseExportHerbIdentityReviewArgs } from "./export-herb-identity-review";

describe("parseExportHerbIdentityReviewArgs", () => {
  it("accepts only canonical input, requested real-pair count, and private output", () => {
    expect(parseExportHerbIdentityReviewArgs([
      "--input", "herb",
      "--pairs", "200",
      "--output", "review.json",
    ])).toEqual({ input: "herb", pairs: 200, output: "review.json" });
    expect(() => parseExportHerbIdentityReviewArgs(["--input", "herb", "--labels", "gold.json"])).toThrow(/Usage/);
    expect(() => parseExportHerbIdentityReviewArgs(["--input", "herb", "--pairs", "0", "--output", "x"])).toThrow(/positive integer/);
  });
});
