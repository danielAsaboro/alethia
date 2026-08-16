import { describe, expect, it } from "vitest";

import { normalizeFact } from "./normalize-facts";

describe("normalizeFact", () => {
  it("normalizes percentages and durations deterministically", () => {
    expect(normalizeFact({ kind: "percentage", value: 30 })).toEqual({
      kind: "percentage",
      value: 30,
    });
    expect(normalizeFact({ kind: "duration", value: 2, unit: "minutes" })).toEqual({
      kind: "duration",
      value: 120,
      unit: "seconds",
    });
  });

  it("normalizes unordered entity sets without duplicates", () => {
    expect(
      normalizeFact({ kind: "entity_set", values: ["  BETA ", "alpha", "beta"] }),
    ).toEqual({ kind: "entity_set", values: ["alpha", "beta"] });
  });

  it("preserves ordered relationship paths", () => {
    expect(
      normalizeFact({ kind: "relationship_path", relationships: ["ASSERTS", "SUPPORTED_BY"] }),
    ).toEqual({ kind: "relationship_path", relationships: ["ASSERTS", "SUPPORTED_BY"] });
  });

  it("rejects non-finite numeric facts", () => {
    expect(() => normalizeFact({ kind: "number", value: Number.NaN })).toThrow(/finite/);
  });
});
