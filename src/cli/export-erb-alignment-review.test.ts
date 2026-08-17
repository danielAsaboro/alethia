import { describe, expect, it } from "vitest";
import { parseExportErbAlignmentReviewArgs } from "./export-erb-alignment-review";

describe("parseExportErbAlignmentReviewArgs", () => {
  it("requires real input and an output path", () => {
    expect(parseExportErbAlignmentReviewArgs(["--input", "records.jsonl", "--output", "review.json"])).toEqual({ input: "records.jsonl", output: "review.json" });
    expect(() => parseExportErbAlignmentReviewArgs(["--input", "records.jsonl"])).toThrow(/Usage/);
  });
});
