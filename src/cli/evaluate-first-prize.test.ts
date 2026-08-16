import { describe, expect, it } from "vitest";
import { parseEvaluateFirstPrizeArgs } from "./evaluate-first-prize";

describe("parseEvaluateFirstPrizeArgs", () => {
  it("requires HERB input, labels, and output", () => {
    expect(parseEvaluateFirstPrizeArgs(["--herb-input", "herb", "--labels", "labels.json", "--output", "out.json"])).toEqual({ herbInput: "herb", labels: "labels.json", output: "out.json" });
    expect(() => parseEvaluateFirstPrizeArgs([])).toThrow(/Usage/);
  });
});
