import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HydraRepository } from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { buildIngestionRunLedger, mergeIngestionGraphs, type IngestionLedgerRunInput } from "@/ingestion/run-ledger";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { erbInputs: string[]; herbInput: string; output: string }
const usage = "Usage: npm run ingest:track01 -- --erb-input <canonical.jsonl> [--erb-input <canonical.jsonl>] --herb-input <HERB path> --output <artifact.json>";

export function parseIngestTrack01Args(args: string[]): Args {
  const erbInputs: string[] = [];
  let herbInput: string | undefined, output: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!value || !["--erb-input", "--herb-input", "--output"].includes(flag ?? "")) throw new TypeError(usage);
    if (flag === "--erb-input") erbInputs.push(value);
    if (flag === "--herb-input") herbInput = value;
    if (flag === "--output") output = value;
  }
  if (erbInputs.length === 0 || !herbInput || !output) throw new TypeError(usage);
  return { erbInputs, herbInput, output };
}

function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function repository(): HydraRepository { return new HydraRepository({ httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443", token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes", graphId: process.env.HYDRA_GRAPH_ID ?? "default", namespace: process.env.HYDRA_NAMESPACE ?? "default", cellId: process.env.HYDRA_CELL_ID ?? "cell-0" }); }

async function main(): Promise<void> {
  const args = parseIngestTrack01Args(process.argv.slice(2));
  const erbRuns = await Promise.all(args.erbInputs.map(async (inputPath, index): Promise<IngestionLedgerRunInput> => {
    const absolute = path.resolve(inputPath);
    const [bundle, bytes] = await Promise.all([runIngestion(new ErbAdapter(), absolute), readFile(absolute)]);
    return { dataset: `Enterprise RAG Bench canonical slice ${index + 1}`, inputPath: absolute, inputSha256: sha256(bytes), bundle, graph: mapIngestionToGraph(bundle) };
  }));
  const herbPath = path.resolve(args.herbInput);
  const herbBundle = await runIngestion(new HerbAdapter(), herbPath);
  const herbDigest = createHash("sha256").update(JSON.stringify(herbBundle.records.map((record) => record.payloadDigest))).digest("hex");
  const runs: IngestionLedgerRunInput[] = [...erbRuns, { dataset: "Salesforce HERB", inputPath: herbPath, inputSha256: herbDigest, bundle: herbBundle, graph: mapIngestionToGraph(herbBundle) }];
  const ledger = buildIngestionRunLedger(runs);
  const replay = buildIngestionRunLedger(runs);
  if (JSON.stringify(ledger.mutationIds) !== JSON.stringify(replay.mutationIds) || ledger.graphFingerprint.sha256 !== replay.graphFingerprint.sha256) throw new Error("Ingestion replay identifiers are unstable");
  const graph = mergeIngestionGraphs(runs.map((run) => run.graph));
  const hydra = repository();
  try {
    await hydra.writeGraph(graph);
    const firstPresence = await hydra.getPresence(graph);
    await hydra.writeGraph(graph);
    const replayPresence = await hydra.getPresence(graph);
    const expected = { nodes: graph.nodes.length, edges: graph.edges.length };
    if (JSON.stringify(firstPresence) !== JSON.stringify(expected) || JSON.stringify(replayPresence) !== JSON.stringify(expected)) throw new Error("HydraDB representative ingestion replay is incomplete");
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commandScope: { erbInputs: args.erbInputs.map((item) => path.resolve(item)), herbInput: herbPath },
      ledger,
      replayVerification: { mutationIdsStable: true, graphFingerprintStable: true, firstPresence, replayPresence, idempotentWriteCount: 2 },
      limitations: ["Misfiled relationships are counted only when canonical graph evidence explicitly marks MISFILED_AS; no text heuristic invents that label.", "The ERB inputs are bounded canonical conflict and decoy/holdout slices, not the full corpus."],
    };
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, recordsAttempted: ledger.recordsAttempted, counts: ledger.counts, scope: ledger.scope, noise: ledger.noise, graphFingerprint: ledger.graphFingerprint.sha256, firstPresence, replayPresence }));
  } finally { await hydra.close(); }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
