import { describe, expect, test } from "vitest";

import { parseBuildConflictEngineeringProofArgs } from "./build-conflict-engineering-proof";

describe("build-conflict-engineering-proof CLI", () => {
  test("requires clean claims, causal artifacts, all four top-k runs, and batching evidence", () => {
    expect(parseBuildConflictEngineeringProofArgs([
      "--claims", "claims.json",
      "--runtime", "runtime.json",
      "--scored", "scored.json",
      "--top-k", "k5.json",
      "--top-k", "k10.json",
      "--top-k", "k20.json",
      "--top-k", "k50.json",
      "--batching", "batching.json",
      "--output", "proof.json",
    ])).toEqual({
      claims: "claims.json",
      runtime: "runtime.json",
      scored: "scored.json",
      topK: ["k5.json", "k10.json", "k20.json", "k50.json"],
      batching: "batching.json",
      output: "proof.json",
    });
  });

  test("rejects missing or duplicate top-k coverage", () => {
    expect(() => parseBuildConflictEngineeringProofArgs([
      "--claims", "claims.json", "--runtime", "runtime.json", "--scored", "scored.json",
      "--top-k", "k5.json", "--batching", "batching.json", "--output", "proof.json",
    ])).toThrow(/four --top-k/);
  });
});
