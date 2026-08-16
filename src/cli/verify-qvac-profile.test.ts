import { describe, expect, it } from "vitest";

import {
  canonicalBoundarySlice,
  parseVerifyQvacProfileArgs,
} from "./verify-qvac-profile";

describe("canonicalBoundarySlice", () => {
  it("keeps the final complete JSON string near a bounded source edge", () => {
    const source = `${"x".repeat(80)}\n    "edge-value",\n    "partial`;
    const slice = canonicalBoundarySlice(source, 110);
    expect(slice.body).toBe(`${"x".repeat(80)}\n    "edge-value"`);
    expect(slice.finalCompleteString).toBe("edge-value");
    expect(slice.body.endsWith('"edge-value"')).toBe(true);
  });

  it("uses a complete object string value close to the requested edge", () => {
    const prefix = `${"x".repeat(80)}\n    \"earlier\",\n`;
    const source = `${prefix}${"y".repeat(60)}\n    \"field\": \"edge-value\",\n    \"partial`;
    const slice = canonicalBoundarySlice(source, source.length);
    expect(slice.finalCompleteString).toBe("edge-value");
    expect(slice.body.length).toBeGreaterThan(prefix.length + 50);
  });

  it("prefers a semantic text value over a trailing identifier or timestamp", () => {
    const source = `  \"text\": \"grounded boundary statement\",\n  \"name\": \"less-semantic-name\",\n  \"timestamp\": \"2026-08-20T00:00:00\",\n`;
    const slice = canonicalBoundarySlice(source, source.length);
    expect(slice.finalCompleteString).toBe("grounded boundary statement");
    expect(slice.body.endsWith('"grounded boundary statement"')).toBe(true);
  });
});

describe("parseVerifyQvacProfileArgs", () => {
  it("accepts a separate native offload log", () => {
    expect(parseVerifyQvacProfileArgs([
      "--documents", "d",
      "--boundary-source", "b",
      "--server-log", "s",
      "--native-log", "n",
      "--config", "c",
      "--model", "m",
      "--output", "o",
    ])).toMatchObject({ serverLog: "s", nativeLog: "n" });
  });
});
