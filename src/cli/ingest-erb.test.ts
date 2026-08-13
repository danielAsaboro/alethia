import { describe, expect, it } from "vitest";

import { parseIngestErbArgs } from "./ingest-erb";

describe("parseIngestErbArgs", () => {
  it("requires explicit canonical input and local output paths", () => {
    expect(
      parseIngestErbArgs([
        "--input",
        "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
        "--output",
        ".local/erb-conflicts.json",
      ]),
    ).toEqual({
      input: "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
      output: ".local/erb-conflicts.json",
    });
  });

  it("rejects implicit input or output", () => {
    expect(() => parseIngestErbArgs([])).toThrow(
      "Usage: npm run ingest:erb -- --input <path> --output <path>",
    );
  });
});
