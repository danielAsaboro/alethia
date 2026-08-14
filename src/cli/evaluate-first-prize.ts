import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scoreFirstPrizeResults, runFirstPrizeCases } from "@/evaluation/run-first-prize-evaluation";
import { HydraRepository } from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { herbInput: string; output: string }
const usage = "Usage: npm run evaluate:first-prize -- --herb-input <path> --output <json-path>";
export function parseEvaluateFirstPrizeArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || (flag !== "--herb-input" && flag !== "--output")) throw new TypeError(usage);
    if (flag === "--herb-input") values.herbInput = value;
    if (flag === "--output") values.output = value;
  }
  if (!values.herbInput || !values.output) throw new TypeError(usage);
  return values as Args;
}

function repository() { return new HydraRepository({ httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443", token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes", graphId: process.env.HYDRA_GRAPH_ID ?? "default", namespace: process.env.HYDRA_NAMESPACE ?? "default", cellId: process.env.HYDRA_CELL_ID ?? "cell-0" }); }

async function main() {
  const args = parseEvaluateFirstPrizeArgs(process.argv.slice(2));
  const hydra = repository();
  try {
    const runtimeResults = await runFirstPrizeCases(hydra);
    const ingestion = await runIngestion(new HerbAdapter(), args.herbInput);
    const graph = mapIngestionToGraph(ingestion);
    const accepted = ingestion.resolution.decisions.filter((decision) => decision.status === "accepted");
    const sameName = ingestion.resolution.decisions.filter((decision) => decision.signals.some((signal) => signal.kind === "name_similarity"));
    const hardNegative = ingestion.resolution.decisions.filter((decision) => decision.constraints.includes("employee_id_conflict"));
    const score = scoreFirstPrizeResults(runtimeResults, {
      records: ingestion.records.length,
      acceptedExactLinks: accepted.length,
      sameNameCandidates: sameName.length,
      hardNegativePairs: hardNegative.length,
      sourceTruceFalseMerges: accepted.filter((decision) => decision.constraints.includes("employee_id_conflict")).length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
    });
    const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), separation: "Runtime workspaces freeze before evaluation labels are applied.", runtimeResults, score };
    const output = path.resolve(args.output);
    const markdown = output.replace(/\.json$/i, ".md");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await writeFile(markdown, `# SourceTruce first-prize evaluation\n\n- Attempted: ${score.attempted}\n- Completed: ${score.completed}\n- Failed: ${score.failed}\n- Case accuracy: ${(score.caseAccuracy * 100).toFixed(1)}%\n- Live Hydra latency p50 / p95: ${score.p50LatencyMs} ms / ${score.p95LatencyMs} ms\n- Identity hard negatives blocked: ${score.lanes.identity.hardNegativePairs}\n- Identity false merges: ${score.lanes.identity.sourceTruceFalseMerges}\n- Graph: ${score.lanes.identity.graphNodes} nodes / ${score.lanes.identity.graphEdges} edges\n\nLimit: this focused evaluation contains one fully adjudicated ERB conflict case, not a score over all 20 conflict questions. All 20 extraction attempts are reported separately.\n`, "utf8");
    console.log(JSON.stringify({ output, markdown, attempted: score.attempted, completed: score.completed, caseAccuracy: score.caseAccuracy }));
    if (score.failed > 0) process.exitCode = 1;
  } finally { await hydra.close(); }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
