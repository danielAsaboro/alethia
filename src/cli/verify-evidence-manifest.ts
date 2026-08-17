import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildEvidenceManifest, verifyEvidenceManifest, type EvidenceManifest } from "@/evaluation/evidence-manifest";

const usage = "Usage: npm run verify:evidence -- --root <evidence-dir> --commit <git-sha> --output <manifest.json> [--verify <manifest.json> | --artifact <relative-path> ...]";

interface Args { root: string; commit: string; output: string; verify?: string; artifacts: string[] }

export function parseEvidenceManifestArgs(values: string[]): Args {
  const parsed: Partial<Args> & { artifacts: string[] } = { artifacts: [] };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index], value = values[index + 1];
    if (!flag || !value) throw new TypeError(usage);
    if (flag === "--artifact") parsed.artifacts.push(value);
    else if (flag === "--root") parsed.root = value;
    else if (flag === "--commit") parsed.commit = value;
    else if (flag === "--output") parsed.output = value;
    else if (flag === "--verify") parsed.verify = value;
    else throw new TypeError(usage);
  }
  if (!parsed.root || !parsed.commit || !parsed.output || Boolean(parsed.verify) === Boolean(parsed.artifacts.length)) throw new TypeError(usage);
  return parsed as Args;
}

async function main() {
  const args = parseEvidenceManifestArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  let manifest: EvidenceManifest;
  if (args.verify) {
    manifest = JSON.parse(await readFile(path.resolve(args.verify), "utf8")) as EvidenceManifest;
    if (manifest.commit !== args.commit) throw new Error(`Evidence manifest commit mismatch: expected ${args.commit}, observed ${manifest.commit}`);
    await verifyEvidenceManifest(manifest, root);
  } else {
    manifest = await buildEvidenceManifest({ root, commit: args.commit, artifacts: args.artifacts });
  }
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, commit: manifest.commit, verifiedCount: manifest.artifacts.length }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
