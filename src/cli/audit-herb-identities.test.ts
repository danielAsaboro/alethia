import { describe, expect, it } from "vitest";
import { parseAuditHerbIdentityArgs } from "./audit-herb-identities";

describe("parseAuditHerbIdentityArgs", () => {
  it("requires canonical HERB input and an evidence output", () => {
    expect(parseAuditHerbIdentityArgs([
      "--input", "herb",
      "--labels", "identity-labels.json",
      "--output", "audit.json",
    ])).toEqual({ input: "herb", labels: "identity-labels.json", output: "audit.json" });
    expect(() => parseAuditHerbIdentityArgs(["--input", "herb"])).toThrow(/Usage/);
  });
});
