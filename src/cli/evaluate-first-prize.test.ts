import { describe, expect, it } from "vitest";
import { parseEvaluateFirstPrizeArgs } from "./evaluate-first-prize";

describe("parseEvaluateFirstPrizeArgs", () => {
  it("requires HERB input and output", () => {
    expect(parseEvaluateFirstPrizeArgs(["--herb-input", "herb", "--output", "out.json"])).toEqual({ herbInput: "herb", output: "out.json" });
    expect(() => parseEvaluateFirstPrizeArgs([])).toThrow(/Usage/);
  });
});
