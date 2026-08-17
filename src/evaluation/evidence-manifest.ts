import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface EvidenceManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface EvidenceManifest {
  schemaVersion: 1;
  generatedAt: string;
  commit: string;
  artifacts: EvidenceManifestEntry[];
}

interface BuildOptions {
  root: string;
  commit: string;
  artifacts: string[];
  generatedAt?: string;
}

function validateCommit(commit: string): void {
  if (!/^[0-9a-f]{7,40}$/u.test(commit)) throw new TypeError("Evidence manifest requires a full Git commit hash or unambiguous hexadecimal commit ID");
}

function resolveInsideRoot(root: string, artifact: string): { absolute: string; relative: string } {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, artifact);
  const relative = path.relative(absoluteRoot, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new TypeError(`Artifact is outside evidence root: ${artifact}`);
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

async function digestArtifact(absolute: string, relative: string): Promise<EvidenceManifestEntry> {
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new TypeError(`Evidence artifact is not a regular file: ${relative}`);
  const bytes = await readFile(absolute);
  return { path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function buildEvidenceManifest(options: BuildOptions): Promise<EvidenceManifest> {
  validateCommit(options.commit);
  if (options.artifacts.length === 0) throw new TypeError("Evidence manifest requires at least one artifact");
  const resolved = options.artifacts.map((artifact) => resolveInsideRoot(options.root, artifact));
  const paths = resolved.map(({ relative }) => relative);
  if (new Set(paths).size !== paths.length) throw new TypeError("Evidence manifest contains a duplicate artifact path");
  const artifacts = await Promise.all(resolved.map(({ absolute, relative }) => digestArtifact(absolute, relative)));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  return { schemaVersion: 1, generatedAt: options.generatedAt ?? new Date().toISOString(), commit: options.commit, artifacts };
}

export async function verifyEvidenceManifest(manifest: EvidenceManifest, root: string) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) throw new TypeError("Invalid evidence manifest");
  validateCommit(manifest.commit);
  const paths = manifest.artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) throw new TypeError("Evidence manifest contains a duplicate artifact path");
  for (const expected of manifest.artifacts) {
    const { absolute, relative } = resolveInsideRoot(root, expected.path);
    let observed: EvidenceManifestEntry;
    try {
      observed = await digestArtifact(absolute, relative);
    } catch (error) {
      throw new Error(`Evidence artifact is unavailable: ${expected.path}`, { cause: error });
    }
    if (observed.sha256 !== expected.sha256) throw new Error(`Evidence artifact digest mismatch: ${expected.path}`);
    if (observed.bytes !== expected.bytes) throw new Error(`Evidence artifact size mismatch: ${expected.path}`);
  }
  return { verified: true as const, verifiedCount: manifest.artifacts.length, commit: manifest.commit };
}
