import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { buildIdentityReviewSet } from "@/resolution/build-identity-review-set";

interface Args { input: string; pairs: number; output: string }
const usage = "Usage: npm run export:herb-identity-review -- --input <path> --pairs <positive integer> --output <private path>";

export function parseExportHerbIdentityReviewArgs(args: string[]): Args {
  const values: Partial<{ input: string; pairs: string; output: string }> = {};
  const flags = new Map([["--input", "input"], ["--pairs", "pairs"], ["--output", "output"]] as const);
  for (let index = 0; index < args.length; index += 2) {
    const key = flags.get(args[index] as "--input" | "--pairs" | "--output");
    const value = args[index + 1];
    if (!key || !value) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.input || !values.pairs || !values.output) throw new TypeError(usage);
  const pairs = Number(values.pairs);
  if (!Number.isInteger(pairs) || pairs <= 0) throw new TypeError("--pairs must be a positive integer");
  return { input: values.input, pairs, output: values.output };
}

async function main(): Promise<void> {
  const options = parseExportHerbIdentityReviewArgs(process.argv.slice(2));
  const ingestion = await runIngestion(new HerbAdapter(), options.input);
  if (ingestion.rejected.length > 0) throw new Error(`HERB review input contains ${ingestion.rejected.length} rejected records`);
  const review = buildIdentityReviewSet(ingestion.records, ingestion.resolution.decisions, options.pairs);
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output,
    candidates: review.candidates.length,
    availableResolverCandidates: review.availableResolverCandidates,
    runtimeDecisionDigest: review.runtimeDecisionDigest,
    labelBlind: review.labelBlind,
  }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
