import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyClaim } from "./claim-ledger";
import { parseVerifyReadmeClaimsArgs } from "@/cli/verify-readme-claims";

describe("verifyClaim", () => {
  it("rejects a missing artifact", async () => {
    await expect(verifyClaim({
      id: "missing",
      claim: "attempted cases",
      value: 11,
      artifact: "/definitely/missing/source-truce-evidence.json",
      jsonPointer: "/score/attempted",
      command: "npm test",
      commit: "abc1234",
      timestamp: "2026-08-20T00:00:00.000Z",
      qualifier: "local development cases",
    })).rejects.toThrow(/artifact/i);
  });

  it("rejects a stale or mismatched JSON pointer value", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sourcetruce-claim-"));
    const artifact = path.join(directory, "score.json");
    await writeFile(artifact, JSON.stringify({ score: { attempted: 4 } }));
    await expect(verifyClaim({
      id: "mismatch",
      claim: "attempted cases",
      value: 8,
      artifact,
      jsonPointer: "/score/attempted",
      command: "npm test",
      commit: "abc1234",
      timestamp: "2026-08-20T00:00:00.000Z",
      qualifier: "local development cases",
    })).rejects.toThrow(/mismatch/i);
  });

  it("returns the verified artifact digest for an exact value", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sourcetruce-claim-"));
    const artifact = path.join(directory, "score.json");
    await writeFile(artifact, JSON.stringify({ scope: { systems: ["a", "b"] } }));
    await expect(verifyClaim({
      id: "exact",
      claim: "source systems",
      value: ["a", "b"],
      artifact,
      jsonPointer: "/scope/systems",
      command: "npm test",
      commit: "abc1234",
      timestamp: "2026-08-20T00:00:00.000Z",
      qualifier: "representative canonical ingestion",
    })).resolves.toMatchObject({ id: "exact", verified: true, artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
});

describe("parseVerifyReadmeClaimsArgs", () => {
  it("requires a manifest and output path", () => {
    expect(parseVerifyReadmeClaimsArgs(["--manifest", "claims.json", "--output", "verified.json"])).toEqual({ manifest: "claims.json", output: "verified.json" });
    expect(() => parseVerifyReadmeClaimsArgs([])).toThrow(/Usage:/);
  });
});
