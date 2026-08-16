import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { EvaluationAttemptV2 } from "@/evaluation/contract";
import { runFrozenHoldout, type FrozenHoldout } from "@/evaluation/holdout";

interface Args { freeze: string; attempts: string; output: string }
const usage = "Usage: npm run holdout:run -- --freeze <frozen.json> --attempts <real-runtime-attempts.json> --output <executed.json>";

export function parseRunHoldoutArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--freeze": "freeze", "--attempts": "attempts", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || values[key]) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.freeze || !values.attempts || !values.output) throw new TypeError(usage);
  return values as Args;
}

async function main(): Promise<void> {
  const args = parseRunHoldoutArgs(process.argv.slice(2));
  const [freezeBytes, attemptBytes] = await Promise.all([readFile(path.resolve(args.freeze), "utf8"), readFile(path.resolve(args.attempts), "utf8")]);
  const attemptArtifact = JSON.parse(attemptBytes) as { attempts?: EvaluationAttemptV2[]; executionEvidence?: unknown } | EvaluationAttemptV2[];
  const attempts = Array.isArray(attemptArtifact) ? attemptArtifact : attemptArtifact.attempts;
  if (!attempts) throw new TypeError("Real runtime attempt artifact must contain attempts");
  const evidence = Array.isArray(attemptArtifact) ? null : attemptArtifact.executionEvidence ?? null;
  const executed = runFrozenHoldout(JSON.parse(freezeBytes) as FrozenHoldout, attempts, evidence);
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(executed, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, state: executed.state, attempts: attempts.length, attemptsDigest: executed.attemptsDigest, executionDigest: executed.executionDigest }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
