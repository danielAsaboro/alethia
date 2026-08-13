import { describe, expect, it } from "vitest";

import { stableId } from "./ids";

describe("stableId", () => {
  it("keeps an identifier stable when object keys are reordered", () => {
    expect(stableId("claim", { b: 2, a: 1 })).toBe(
      stableId("claim", { a: 1, b: 2 }),
    );
  });

  it("separates otherwise identical values by namespace", () => {
    expect(stableId("claim", "42")).not.toBe(stableId("entity", "42"));
  });

  it("rejects values that cannot be represented deterministically", () => {
    expect(() => stableId("claim", { value: undefined })).toThrow(
      "Unsupported undefined value at $.value",
    );
  });
});
