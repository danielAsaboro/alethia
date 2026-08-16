import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runFirstPrizeCases } from "@/evaluation/run-first-prize-evaluation";
import { summarizeTrials } from "@/evaluation/performance";
import { HydraRepository, type NativePathInput } from "@/hydra/client";

interface Args { ledger: string; trials: number; output: string }
const usage = "Usage: npm run measure:performance -- --ledger <ingestion-ledger.json> --trials <n>=2 --output <artifact.json>";

export function parseMeasurePerformanceArgs(args: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--ledger", "--trials", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const ledger = values.get("--ledger"), output = values.get("--output");
  const trials = Number(values.get("--trials"));
  if (!ledger || !output || !Number.isSafeInteger(trials) || trials < 2 || trials > 20) throw new TypeError(usage);
  return { ledger, trials, output };
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

function requireLedger(value: unknown) {
  const artifact = value as { ledger?: { recordsAttempted?: unknown; counts?: { accepted?: unknown }; scope?: { datasets?: unknown; sourceSystems?: unknown; distinctNativeObjects?: unknown; graphNodes?: unknown; graphEdges?: unknown } } };
  const ledger = artifact?.ledger;
  if (!ledger || !Number.isSafeInteger(ledger.recordsAttempted) || !Number.isSafeInteger(ledger.counts?.accepted) || !Array.isArray(ledger.scope?.datasets) || !Array.isArray(ledger.scope?.sourceSystems) || !Number.isSafeInteger(ledger.scope?.distinctNativeObjects) || !Number.isSafeInteger(ledger.scope?.graphNodes) || !Number.isSafeInteger(ledger.scope?.graphEdges)) {
    throw new TypeError("Performance input is not a valid ingestion ledger");
  }
  return {
    recordsAttempted: ledger.recordsAttempted as number,
    recordsAccepted: ledger.counts!.accepted as number,
    datasets: ledger.scope!.datasets as string[],
    sourceSystems: ledger.scope!.sourceSystems as string[],
    distinctNativeObjects: ledger.scope!.distinctNativeObjects as number,
    graphNodes: ledger.scope!.graphNodes as number,
    graphEdges: ledger.scope!.graphEdges as number,
  };
}

function completed(results: Awaited<ReturnType<typeof runFirstPrizeCases>>, phase: string) {
  const failures = results.filter((item) => item.status !== "completed" || !item.workspace);
  if (results.length !== 11 || failures.length > 0) throw new Error(`${phase} did not complete all eleven live cases: ${failures.map((item) => `${item.caseId}:${item.error ?? item.status}`).join(", ")}`);
  return results.map((item) => ({
    caseId: item.caseId,
    latencyMs: item.latencyMs,
    verdict: item.workspace!.verdict,
    queryId: item.workspace!.graphProof.queryId,
    nativeOperation: item.workspace!.graphProof.operation,
    roundTrips: item.workspace!.graphProof.roundTrips,
    graphLatencyMs: item.workspace!.graphProof.latencyMs,
  }));
}

async function main() {
  const args = parseMeasurePerformanceArgs(process.argv.slice(2));
  const ledgerPath = path.resolve(args.ledger);
  const ledger = requireLedger(JSON.parse(await readFile(ledgerPath, "utf8")));
  const pathInput: NativePathInput = {
    sourceLogicalId: "entity_90ad19476a96ae677e3c9143",
    targetLogicalId: "source_object_fa63884437348a11c9312fb9",
    relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
    maxLength: 2,
    pathCount: 1,
  };
  const trials = [];
  for (let index = 0; index < args.trials; index += 1) {
    const hydra = repository();
    try {
      const coldStarted = performance.now();
      const cold = completed(await runFirstPrizeCases(hydra), `cold-connection trial ${index + 1}`);
      const coldWallMs = performance.now() - coldStarted;
      const warmStarted = performance.now();
      const warm = completed(await runFirstPrizeCases(hydra), `warm-same-connection trial ${index + 1}`);
      const warmWallMs = performance.now() - warmStarted;
      const [nativePaths, clientBaseline] = await Promise.all([
        hydra.findNativePaths(pathInput),
        hydra.findClientPathBaseline(pathInput),
      ]);
      if (nativePaths.length !== 1 || !clientBaseline.found) throw new Error("Performance path comparison did not return both real paths");
      trials.push({
        trial: index + 1,
        coldConnection: { wallMs: coldWallMs, cases: cold },
        warmSameConnection: { wallMs: warmWallMs, cases: warm },
        pathComparison: {
          native: { latencyMs: nativePaths[0]!.latencyMs, roundTrips: nativePaths[0]!.roundTrips, queryIds: nativePaths[0]!.queryIds ?? [nativePaths[0]!.queryId] },
          boundedClientTraversal: { latencyMs: clientBaseline.latencyMs, roundTrips: clientBaseline.roundTrips, queryIds: clientBaseline.queryIds },
        },
      });
    } finally {
      await hydra.close();
    }
  }
  const coldCaseLatencies = trials.flatMap((trial) => trial.coldConnection.cases.map((item) => item.latencyMs));
  const warmCaseLatencies = trials.flatMap((trial) => trial.warmSameConnection.cases.map((item) => item.latencyMs));
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      qualifier: "Local M3 Pro measurements only. Cold means a new HydraRepository connection; it does not claim a cold operating-system or HydraDB page cache. No universal speedup ratio is claimed.",
      casesPerPhase: 11,
      ...ledger,
      ingestionLedger: ledgerPath,
    },
    hardware: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    software: { node: process.version, hydraImage: "ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709" },
    summary: {
      coldConnectionCaseLatencyMs: summarizeTrials(coldCaseLatencies),
      warmSameConnectionCaseLatencyMs: summarizeTrials(warmCaseLatencies),
      coldConnectionWallMs: summarizeTrials(trials.map((trial) => trial.coldConnection.wallMs)),
      warmSameConnectionWallMs: summarizeTrials(trials.map((trial) => trial.warmSameConnection.wallMs)),
      nativePathLatencyMs: summarizeTrials(trials.map((trial) => trial.pathComparison.native.latencyMs)),
      boundedClientPathLatencyMs: summarizeTrials(trials.map((trial) => trial.pathComparison.boundedClientTraversal.latencyMs)),
    },
    trials,
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, trials: trials.length, coldSamples: coldCaseLatencies.length, warmSamples: warmCaseLatencies.length }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
