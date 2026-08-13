import { describe, expect, it } from "vitest";

import { parseQvacSmokeArgs } from "./qvac-smoke";

describe("parseQvacSmokeArgs", () => {
  it("requires a real input and evidence destination", () => {
    expect(
      parseQvacSmokeArgs([
        "--input",
        "../resources/HERB",
        "--evidence",
        "../submission/evidence/qvac/herb-employee.json",
      ]),
    ).toEqual({
      input: "../resources/HERB",
      evidence: "../submission/evidence/qvac/herb-employee.json",
    });
  });

  it("rejects an implicit corpus", () => {
    expect(() => parseQvacSmokeArgs([])).toThrow(
      "Usage: npm run qvac:smoke -- --input <path> --evidence <path>",
    );
  });
});
