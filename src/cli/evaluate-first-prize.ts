import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseEvaluationLabelsV2 } from "@/evaluation/contract";
import {
  freezeFirstPrizeResults,
  scoreFirstPrizeResultsV2,
  runFirstPrizeCases,
  type FrozenCaseResult,
} from "@/evaluation/run-first-prize-evaluation";
import { HydraRepository } from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { herbInput: string; labels: string; output: string }
const usage = "Usage: npm run evaluate:first-prize -- --herb-input <path> --labels <labels.json> --output <json-path>";
export function parseEvaluateFirstPrizeArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || !["--herb-input", "--labels", "--output"].includes(flag ?? "")) throw new TypeError(usage);
    if (flag === "--herb-input") values.herbInput = value;
    if (flag === "--labels") values.labels = value;
    if (flag === "--output") values.output = value;
  }
  if (!values.herbInput || !values.labels || !values.output) throw new TypeError(usage);
  return values as Args;
}

function repository() { return new HydraRepository({ httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443", token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes", graphId: process.env.HYDRA_GRAPH_ID ?? "default", namespace: process.env.HYDRA_NAMESPACE ?? "default", cellId: process.env.HYDRA_CELL_ID ?? "cell-0" }); }

async function main() {
  const args = parseEvaluateFirstPrizeArgs(process.argv.slice(2));
  const hydra = repository();
  try {
    const runtimeResults = await runFirstPrizeCases(hydra);
    const frozen = freezeFirstPrizeResults(runtimeResults);
    const verifiedRuntimeResults = JSON.parse(frozen.serialized) as FrozenCaseResult[];
    const labelBytes = await readFile(path.resolve(args.labels), "utf8");
    const labels = parseEvaluationLabelsV2(JSON.parse(labelBytes));
    const ingestion = await runIngestion(new HerbAdapter(), args.herbInput);
    const graph = mapIngestionToGraph(ingestion);
    const accepted = ingestion.resolution.decisions.filter((decision) => decision.status === "accepted");
    const sameName = ingestion.resolution.decisions.filter((decision) => decision.signals.some((signal) => signal.kind === "name_similarity"));
    const hardNegative = ingestion.resolution.decisions.filter((decision) => decision.constraints.includes("employee_id_conflict"));
    const identityLane = {
      records: ingestion.records.length,
      acceptedExactLinks: accepted.length,
      sameNameCandidates: sameName.length,
      hardNegativePairs: hardNegative.length,
      alethiaFalseMerges: accepted.filter((decision) => decision.constraints.includes("employee_id_conflict")).length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
    };
    const score = scoreFirstPrizeResultsV2(verifiedRuntimeResults, labels.labels);
    const artifact = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      separation: "Runtime workspaces and their digest freeze before the label file is opened.",
      runtimeSha256: frozen.sha256,
      runtimeResults: verifiedRuntimeResults,
      score,
      identityLane,
    };
    const output = path.resolve(args.output);
    const markdown = output.replace(/\.json$/i, ".md");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await writeFile(markdown, `# Alethia generic judge-case evaluation\n\n- Runtime SHA-256: \`${frozen.sha256}\`\n- Attempted: ${score.counts.attempted}\n- Completed: ${score.counts.completed}\n- Rejected: ${score.counts.rejected}\n- Failed: ${score.counts.failed}\n- Unscored: ${score.counts.unscored}\n- Answer correctness / completeness: ${(score.answerCorrectness * 100).toFixed(1)}% / ${(score.answerCompleteness * 100).toFixed(1)}%\n- Verdict accuracy: ${(score.verdictAccuracy * 100).toFixed(1)}%\n- Evidence precision / recall / F1: ${score.evidence.precision ?? "undefined"} / ${score.evidence.recall ?? "undefined"} / ${score.evidence.f1 ?? "undefined"}\n- Live Hydra latency p50 / p95: ${score.latency.p50Ms} ms / ${score.latency.p95Ms} ms\n- Identity hard negatives observed: ${identityLane.hardNegativePairs}\n- Identity false merges on known hard constraints: ${identityLane.alethiaFalseMerges}\n- Graph: ${identityLane.graphNodes} nodes / ${identityLane.graphEdges} edges\n\nThis is a labeled development-case evaluation. It is not an untouched holdout result.\n`, "utf8");
    console.log(JSON.stringify({ output, markdown, attempted: score.counts.attempted, completed: score.counts.completed, answerCorrectness: score.answerCorrectness }));
    if (score.counts.failed > 0 || score.counts.rejected > 0 || score.counts.unscored > 0) process.exitCode = 1;
  } finally { await hydra.close(); }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
