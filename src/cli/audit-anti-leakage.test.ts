import { describe, expect, it } from "vitest";
import { parseAuditAntiLeakageArgs } from "./audit-anti-leakage";

describe("parseAuditAntiLeakageArgs", () => {
  it("uses the repository root by default and validates flags", () => {
    expect(parseAuditAntiLeakageArgs([])).toEqual({ root: "." });
    expect(parseAuditAntiLeakageArgs(["--root", "repo", "--output", "audit.json"])).toEqual({ root: "repo", output: "audit.json" });
    expect(() => parseAuditAntiLeakageArgs(["--labels", "gold.json"])).toThrow(/Usage/);
  });
});
