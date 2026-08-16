import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyClaim, type EvidenceClaim } from "@/evaluation/claim-ledger";

interface Args { manifest: string; output: string }
const usage = "Usage: npm run verify:readme-claims -- --manifest <claims.json> --output <verified-ledger.json>";

export function parseVerifyReadmeClaimsArgs(args: string[]): Args {
  if (args.length !== 4) throw new TypeError(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--manifest", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const manifest = values.get("--manifest"), output = values.get("--output");
  if (!manifest || !output) throw new TypeError(usage);
  return { manifest, output };
}

async function main() {
  const args = parseVerifyReadmeClaimsArgs(process.argv.slice(2));
  const manifestPath = path.resolve(args.manifest);
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as { schemaVersion?: unknown; claims?: unknown };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.claims) || parsed.claims.length === 0) throw new TypeError("README claim manifest must contain at least one schema-v1 claim");
  const verified = [];
  for (const claim of parsed.claims as EvidenceClaim[]) verified.push(await verifyClaim(claim));
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), manifest: manifestPath, verifiedCount: verified.length, claims: verified }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, verifiedCount: verified.length }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
