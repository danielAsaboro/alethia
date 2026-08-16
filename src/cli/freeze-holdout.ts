import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseRuntimeManifestV2 } from "@/evaluation/contract";
import { freezeHoldout, type HoldoutDesign } from "@/evaluation/holdout";

interface Args { runtime: string; config: string; output: string }
const usage = "Usage: npm run holdout:freeze -- --runtime <runtime.json> --config <config.json> --output <frozen.json>";

export function parseFreezeHoldoutArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--runtime": "runtime", "--config": "config", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || values[key]) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.runtime || !values.config || !values.output) throw new TypeError(usage);
  return values as Args;
}

async function main(): Promise<void> {
  const args = parseFreezeHoldoutArgs(process.argv.slice(2));
  const [runtimeBytes, configBytes] = await Promise.all([readFile(path.resolve(args.runtime), "utf8"), readFile(path.resolve(args.config), "utf8")]);
  const runtime = parseRuntimeManifestV2(JSON.parse(runtimeBytes));
  const config = JSON.parse(configBytes) as Omit<HoldoutDesign, "runtime">;
  const frozen = freezeHoldout({ ...config, runtime });
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, state: frozen.state, cases: frozen.runtime.cases.length, runtimeDigest: frozen.runtimeDigest, freezeDigest: frozen.freezeDigest }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
