import { describe, expect, it } from "vitest";

import { parseEvaluateHerbArgs } from "./evaluate-herb";

describe("parseEvaluateHerbArgs", () => {
  it("requires explicit real input and evidence paths", () => {
    expect(
      parseEvaluateHerbArgs([
        "--input",
        "../resources/HERB",
        "--evidence",
        "../submission/evidence/evaluation/herb-hydra.json",
      ]),
    ).toEqual({
      input: "../resources/HERB",
      evidence: "../submission/evidence/evaluation/herb-hydra.json",
    });
  });

  it("does not permit an implicit or fake corpus", () => {
    expect(() => parseEvaluateHerbArgs([])).toThrow(
      "Usage: npm run evaluate:herb -- --input <path> --evidence <path>",
    );
  });
});
