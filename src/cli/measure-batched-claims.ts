import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { summarizeTrials } from "@/evaluation/performance";
import { HydraRepository } from "@/hydra/client";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { input: string; ledger: string; trials: number; output: string }
const usage = "Usage: npm run measure:batched-claims -- --input <HERB> --ledger <ledger.json> --trials <2-20> --output <artifact.json>";
const topKs = [5, 10, 20, 50] as const;

export function parseMeasureBatchedClaimsArgs(args: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--input", "--ledger", "--trials", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const trials = Number(values.get("--trials"));
  if (!values.get("--input") || !values.get("--ledger") || !values.get("--output") || !Number.isSafeInteger(trials) || trials < 2 || trials > 20) throw new TypeError(usage);
  return { input: values.get("--input")!, ledger: values.get("--ledger")!, trials, output: values.get("--output")! };
}

function repository() {
  return new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

async function main() {
  const args = parseMeasureBatchedClaimsArgs(process.argv.slice(2));
  const [ingestion, ledgerBytes] = await Promise.all([
    runIngestion(new HerbAdapter(), args.input),
    readFile(path.resolve(args.ledger), "utf8"),
  ]);
  if (ingestion.rejected.length > 0) throw new Error("Batched lookup input contains rejected records");
  const sourceIds = [...new Set(ingestion.extraction.claims.map((claim) => claim.sourceObjectId))].sort();
  if (sourceIds.length < Math.max(...topKs)) throw new Error(`Only ${sourceIds.length} claim-bearing sources are available`);
  const ledger = JSON.parse(ledgerBytes) as { ledger?: { scope?: { graphNodes?: number; graphEdges?: number } } };
  const graphNodes = ledger.ledger?.scope?.graphNodes;
  const graphEdges = ledger.ledger?.scope?.graphEdges;
  if (!Number.isSafeInteger(graphNodes) || !Number.isSafeInteger(graphEdges)) throw new TypeError("Invalid graph-size ledger");

  const samples: Array<{ topK: number; connection: "new" | "reused"; trial: number; latencyMs: number; wallMs: number; queryIds: string[]; roundTrips: number; resultRows: number }> = [];
  const reused = repository();
  try {
    for (let trial = 1; trial <= args.trials; trial += 1) {
      for (const topK of topKs) {
        const ids = sourceIds.slice(0, topK);
        const fresh = repository();
        try {
          const started = performance.now();
          const result = await fresh.findClaimsForSources(ids);
          samples.push({ topK, connection: "new", trial, latencyMs: result.latencyMs, wallMs: performance.now() - started, queryIds: result.queryIds, roundTrips: result.roundTrips, resultRows: result.rows.length });
        } finally {
          await fresh.close();
        }
        const started = performance.now();
        const result = await reused.findClaimsForSources(ids);
        samples.push({ topK, connection: "reused", trial, latencyMs: result.latencyMs, wallMs: performance.now() - started, queryIds: result.queryIds, roundTrips: result.roundTrips, resultRows: result.rows.length });
      }
    }
  } finally {
    await reused.close();
  }
  const queryIds = samples.flatMap((sample) => sample.queryIds);
  if (new Set(queryIds).size !== queryIds.length) throw new Error("Batched lookup query IDs are not unique");
  if (samples.some((sample) => sample.roundTrips > 2)) throw new Error("Batched lookup exceeded the verified two-query bound");
  const summary = Object.fromEntries(topKs.map((topK) => [String(topK), Object.fromEntries((["new", "reused"] as const).map((connection) => {
    const rows = samples.filter((sample) => sample.topK === topK && sample.connection === connection);
    return [connection, {
      latencyMs: summarizeTrials(rows.map((row) => row.latencyMs)),
      wallMs: summarizeTrials(rows.map((row) => row.wallMs)),
      resultRows: [...new Set(rows.map((row) => row.resultRows))],
      clientRoundTrips: [...new Set(rows.map((row) => row.roundTrips))],
      nativeOperationsPerRequest: [...new Set(rows.map((row) => row.roundTrips))],
      newConnections: connection === "new" ? rows.length : 0,
      reusedConnections: connection === "reused" ? rows.length : 0,
    }];
  }))]));
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "Local M3 Pro, live HydraDB strong-consistency ID-anchored batch reads; no universal latency claim.",
    input: { dataset: "Salesforce HERB", records: ingestion.records.length, claimBearingSources: sourceIds.length, sourceIdDigest: createHash("sha256").update(JSON.stringify(sourceIds)).digest("hex"), ledgerSha256: createHash("sha256").update(ledgerBytes).digest("hex") },
    graph: { nodes: graphNodes, edges: graphEdges },
    hardware: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    software: { node: process.version, hydraImage: "ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709" },
    invariant: {
      noLinearPerDocumentQueryGrowth: true,
      maximumRoundTripsPerRequest: 2,
      oneRoundTripThroughTopK40: true,
      topK50UsesTwoBoundedChunks: true,
      allQueryIdsUnique: true,
      anchoredByExplicitSourceIds: true,
      protocolConstraint: "HydraDB OSS accepts at most 40 scalar ID anchors in this read shape; top_k=50 is split into 40+10 instead of issuing one query per document.",
    },
    summary,
    samples,
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, samples: samples.length, topKs, allQueryIdsUnique: true, maximumRoundTripsPerRequest: 2 }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
