import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildEvidenceManifest, verifyEvidenceManifest } from "./evidence-manifest";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("evidence manifest", () => {
  it("binds every requested artifact to its relative path, size, and SHA-256", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-manifest-"));
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "a.json"), "{\"passed\":true}\n");
    await writeFile(path.join(root, "nested", "b.txt"), "failure retained\n");

    const manifest = await buildEvidenceManifest({
      root,
      commit: "0123456789abcdef0123456789abcdef01234567",
      artifacts: ["nested/b.txt", "a.json"],
    });

    expect(manifest.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(manifest.artifacts).toEqual([
      { path: "a.json", bytes: 16, sha256: sha256("{\"passed\":true}\n") },
      { path: "nested/b.txt", bytes: 17, sha256: sha256("failure retained\n") },
    ]);
    await expect(verifyEvidenceManifest(manifest, root)).resolves.toMatchObject({ verifiedCount: 2 });
  });

  it("rejects artifacts outside the declared evidence root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-manifest-"));
    await expect(buildEvidenceManifest({ root, commit: "0123456", artifacts: ["../secret.txt"] }))
      .rejects.toThrow("outside evidence root");
  });

  it("fails closed when an artifact changes or disappears", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-manifest-"));
    await writeFile(path.join(root, "result.json"), "{}\n");
    const manifest = await buildEvidenceManifest({ root, commit: "0123456", artifacts: ["result.json"] });
    await writeFile(path.join(root, "result.json"), "{\"changed\":true}\n");
    await expect(verifyEvidenceManifest(manifest, root)).rejects.toThrow("digest mismatch");
  });

  it("rejects malformed commit bindings and duplicate artifact paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-manifest-"));
    await writeFile(path.join(root, "result.json"), "{}\n");
    await expect(buildEvidenceManifest({ root, commit: "main", artifacts: ["result.json"] }))
      .rejects.toThrow("full Git commit");
    await expect(buildEvidenceManifest({ root, commit: "0123456", artifacts: ["result.json", "result.json"] }))
      .rejects.toThrow("duplicate artifact");
  });
});
