import { describe, expect, it } from "vitest";

import { assertLabelFreeCausalRuntime, parseRunCausalArgs } from "./run-causal-evaluation";

describe("causal runner boundaries", () => {
  it("rejects nested evaluation labels before making model requests", () => {
    expect(() => assertLabelFreeCausalRuntime({ cases: [{ graph: { gold_answer: "secret" } }] })).toThrow(/forbidden evaluation field/i);
    expect(() => assertLabelFreeCausalRuntime({ cases: [{ graph: { hydraQueryIds: ["q1"] } }] })).not.toThrow();
  });

  it("requires an immutable runtime and output path", () => {
    expect(parseRunCausalArgs(["--runtime", "runtime.json", "--output", "result.json"])).toEqual({ runtime: "runtime.json", output: "result.json" });
    expect(parseRunCausalArgs(["--runtime", "runtime.json", "--parity-from", "first.json", "--output", "result.json"])).toEqual({ runtime: "runtime.json", output: "result.json", parityFrom: "first.json" });
    expect(() => parseRunCausalArgs([])).toThrow(/Usage:/);
  });
});
