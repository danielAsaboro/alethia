import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyClaim, verifyGroupedClaim } from "./claim-ledger";
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

describe("verifyGroupedClaim", () => {
  it("verifies every assertion and records each unique artifact digest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claim-ledger-group-"));
    const first = path.join(directory, "first.json");
    const second = path.join(directory, "second.json");
    await writeFile(first, JSON.stringify({ counts: { attempted: 5, completed: 5 } }));
    await writeFile(second, JSON.stringify({ score: 0.2 }));

    const verified = await verifyGroupedClaim({
      id: "holdout-row",
      claim: "Five cases completed with score 0.2.",
      command: "npm run holdout:score",
      commit: "0123456",
      timestamp: "2026-08-20T00:00:00.000Z",
      qualifier: "Frozen holdout.",
      assertions: [
        { artifact: first, jsonPointer: "/counts/attempted", value: 5 },
        { artifact: first, jsonPointer: "/counts/completed", value: 5 },
        { artifact: second, jsonPointer: "/score", value: 0.2 },
      ],
    });

    expect(verified.verified).toBe(true);
    expect(verified.assertions).toHaveLength(3);
    expect(verified.artifacts).toHaveLength(2);
    expect(verified.artifacts.every((artifact) => Boolean(artifact.sha256))).toBe(true);
  });

  it("fails when any assertion differs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claim-ledger-group-"));
    const artifact = path.join(directory, "result.json");
    await writeFile(artifact, JSON.stringify({ score: 0.1 }));
    await expect(verifyGroupedClaim({
      id: "mismatch",
      claim: "Score is 0.2.",
      command: "score",
      commit: "0123456",
      timestamp: "2026-08-20T00:00:00.000Z",
      qualifier: "Exact.",
      assertions: [{ artifact, jsonPointer: "/score", value: 0.2 }],
    })).rejects.toThrow("Claim value mismatch");
  });
});

describe("parseVerifyReadmeClaimsArgs", () => {
  it("requires a manifest and output path", () => {
    expect(parseVerifyReadmeClaimsArgs(["--manifest", "claims.json", "--output", "verified.json"])).toEqual({ manifest: "claims.json", output: "verified.json" });
    expect(() => parseVerifyReadmeClaimsArgs([])).toThrow(/Usage:/);
  });
});
