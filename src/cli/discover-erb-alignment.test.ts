import { describe, expect, it } from "vitest";
import { parseDiscoverAlignmentArgs } from "./discover-erb-alignment";

describe("parseDiscoverAlignmentArgs", () => {
  it("requires input, manifest, and output", () => {
    expect(parseDiscoverAlignmentArgs(["--input", "a", "--manifest", "b", "--labels", "labels", "--output", "c"])).toEqual({ input: "a", manifest: "b", labels: "labels", output: "c" });
    expect(() => parseDiscoverAlignmentArgs(["--input", "a"])).toThrow(/Usage/);
  });
});
