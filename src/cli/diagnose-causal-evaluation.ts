import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { diagnoseCausalRun, type LabelFreeCausalResultRow } from "@/evaluation/causal-diagnosis";
import type { CausalCaseInput } from "@/evaluation/causal-arms";

interface Args { runtime: string; results: string; output: string }
const usage = "Usage: npm run causal:diagnose -- --runtime <label-free-runtime.json> --results <label-free-results.json> --output <diagnosis.json>";

export function parseDiagnoseCausalArgs(args: string[]): Args {
  if (args.length !== 6) throw new TypeError(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--runtime", "--results", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const runtime = values.get("--runtime"), results = values.get("--results"), output = values.get("--output");
  if (!runtime || !results || !output) throw new TypeError(usage);
  return { runtime, results, output };
}

async function main() {
  const args = parseDiagnoseCausalArgs(process.argv.slice(2));
  const runtime = JSON.parse(await readFile(path.resolve(args.runtime), "utf8")) as { labelFree: true; cases: CausalCaseInput[] };
  const resultArtifact = JSON.parse(await readFile(path.resolve(args.results), "utf8")) as { labelsOpened?: unknown; results?: LabelFreeCausalResultRow[] };
  if (resultArtifact.labelsOpened !== false || !Array.isArray(resultArtifact.results)) {
    throw new TypeError("Causal diagnosis accepts only a label-free runtime result artifact");
  }
  const report = diagnoseCausalRun({ runtime, results: resultArtifact.results });
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...report.summary, labelsOpened: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
