import { describe, expect, it } from "vitest";

import { parseFreezeErbConflictArgs } from "./freeze-erb-conflicts";

describe("parseFreezeErbConflictArgs", () => {
  it("requires manifest, extraction, and frozen output paths", () => {
    expect(
      parseFreezeErbConflictArgs([
        "--manifest",
        "runtime.json",
        "--extractions",
        "extractions.json",
        "--output",
        "frozen.json",
      ]),
    ).toEqual({
      manifest: "runtime.json",
      extractions: "extractions.json",
      output: "frozen.json",
    });
    expect(() => parseFreezeErbConflictArgs([])).toThrow(/Usage:/);
    expect(() =>
      parseFreezeErbConflictArgs([
        "--manifest",
        "a",
        "--manifest",
        "b",
        "--output",
        "c",
      ]),
    ).toThrow(/Usage:/);
  });
});
