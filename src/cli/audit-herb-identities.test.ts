import { describe, expect, it } from "vitest";
import { parseAuditHerbIdentityArgs } from "./audit-herb-identities";

describe("parseAuditHerbIdentityArgs", () => {
  it("requires canonical HERB input and an evidence output", () => {
    expect(parseAuditHerbIdentityArgs(["--input", "herb", "--output", "audit.json"])).toEqual({ input: "herb", output: "audit.json" });
    expect(() => parseAuditHerbIdentityArgs(["--input", "herb"])).toThrow(/Usage/);
  });
});
