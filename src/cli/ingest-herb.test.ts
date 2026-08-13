import { describe, expect, it } from "vitest";

import { parseIngestHerbArgs } from "./ingest-herb";

describe("parseIngestHerbArgs", () => {
  it("requires explicit dataset input and output paths", () => {
    expect(
      parseIngestHerbArgs([
        "--input",
        "../resources/HERB",
        "--output",
        ".local/herb-ingestion.json",
      ]),
    ).toEqual({
      input: "../resources/HERB",
      output: ".local/herb-ingestion.json",
    });
  });

  it("rejects a command without an output path", () => {
    expect(() =>
      parseIngestHerbArgs(["--input", "../resources/HERB"]),
    ).toThrow("Usage: npm run ingest:herb -- --input <path> --output <path>");
  });
});
