import { describe, expect, it } from "vitest";

import { parseAdjudicateErbConflictArgs } from "./adjudicate-erb-conflict";

describe("parseAdjudicateErbConflictArgs", () => {
  it("requires explicit extraction evidence and dossier output", () => {
    expect(
      parseAdjudicateErbConflictArgs([
        "--extractions",
        "../submission/evidence/qvac/erb-conflicts.json",
        "--output",
        "../submission/evidence/cases/qst_0411.json",
      ]),
    ).toEqual({
      extractions: "../submission/evidence/qvac/erb-conflicts.json",
      output: "../submission/evidence/cases/qst_0411.json",
    });
  });

  it("rejects implicit paths", () => {
    expect(() => parseAdjudicateErbConflictArgs([])).toThrow(
      "Usage: npm run adjudicate:erb-conflict",
    );
  });
});
