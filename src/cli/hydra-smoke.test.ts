import { describe, expect, it } from "vitest";

import { parseHydraSmokeArgs } from "./hydra-smoke";

describe("parseHydraSmokeArgs", () => {
  it("requires real dataset and evidence destinations", () => {
    expect(
      parseHydraSmokeArgs([
        "--input",
        "../resources/HERB",
        "--evidence",
        "../submission/evidence/hydradb-roundtrip/result.json",
      ]),
    ).toEqual({
      input: "../resources/HERB",
      evidence: "../submission/evidence/hydradb-roundtrip/result.json",
    });
  });

  it("rejects implicit dataset paths", () => {
    expect(() => parseHydraSmokeArgs([])).toThrow(
      "Usage: npm run hydra:smoke -- --input <path> --evidence <path>",
    );
  });
});
