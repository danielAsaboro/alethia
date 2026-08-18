import { describe, expect, test } from "vitest";

import { parseDiagnoseCausalArgs } from "./diagnose-causal-evaluation";

describe("parseDiagnoseCausalArgs", () => {
  test("requires one sealed runtime, one label-free results artifact, and one output", () => {
    expect(parseDiagnoseCausalArgs([
      "--runtime", "runtime.json",
      "--results", "results.json",
      "--output", "diagnosis.json",
    ])).toEqual({ runtime: "runtime.json", results: "results.json", output: "diagnosis.json" });
    expect(() => parseDiagnoseCausalArgs(["--runtime", "runtime.json"])).toThrow(/Usage:/);
  });
});
