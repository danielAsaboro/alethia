import { describe, expect, it } from "vitest";
import { parseMeasureBatchedClaimsArgs } from "./measure-batched-claims";

describe("parseMeasureBatchedClaimsArgs", () => {
  it("requires bounded trials and every evidence input", () => {
    expect(parseMeasureBatchedClaimsArgs(["--input", "herb", "--ledger", "ledger.json", "--trials", "5", "--output", "out.json"])).toEqual({ input: "herb", ledger: "ledger.json", trials: 5, output: "out.json" });
    expect(() => parseMeasureBatchedClaimsArgs(["--input", "herb", "--ledger", "ledger.json", "--trials", "1", "--output", "out.json"])).toThrow(/Usage/);
  });
});
