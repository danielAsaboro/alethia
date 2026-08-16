import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEvaluationLabelsV2 } from "@/evaluation/contract";
import { scoreFrozenHoldout, type ExecutedHoldout } from "@/evaluation/holdout";

interface Args { execution: string; labels: string; output: string }
const usage = "Usage: npm run holdout:score -- --execution <executed.json> --labels <labels.json> --output <scored.json>";

export function parseScoreHoldoutArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--execution": "execution", "--labels": "labels", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || values[key]) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.execution || !values.labels || !values.output) throw new TypeError(usage);
  return values as Args;
}

async function main(): Promise<void> {
  const args = parseScoreHoldoutArgs(process.argv.slice(2));
  const [executionBytes, labelBytes] = await Promise.all([readFile(path.resolve(args.execution), "utf8"), readFile(path.resolve(args.labels), "utf8")]);
  const labels = parseEvaluationLabelsV2(JSON.parse(labelBytes));
  const scored = scoreFrozenHoldout(JSON.parse(executionBytes) as ExecutedHoldout, labels);
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(scored, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, state: scored.state, labelsDigest: scored.labelsDigest, scoreDigest: scored.scoreDigest, counts: scored.report.counts }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
