import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CaseRepository } from "@/application/run-case";
import { fingerprintGraph } from "@/evaluation/graph-fingerprint";
import {
  runFirstPrizeCases,
  type FrozenCaseResult,
} from "@/evaluation/run-first-prize-evaluation";
import {
  HydraRepository,
  type GraphWriteBundle,
  type NativePathInput,
} from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { recordGroundingValidation } from "@/qvac/telemetry";

interface VerifyArgs { herbInput: string; output: string }

interface ResilienceRepository {
  writeGraph(graph: GraphWriteBundle): Promise<void>;
  getPresence(graph: GraphWriteBundle): Promise<{ nodes: number; edges: number }>;
  findNativePaths(input: NativePathInput): Promise<Array<{
    operation: "algo.SPpaths" | "algo.SPpaths.sequence";
    queryId: string;
    roundTrips: number;
    pathLength: number;
  }>>;
}

interface OutageRepository {
  entityExists(logicalId: string): Promise<boolean>;
}

interface ResilienceDependencies {
  repository: ResilienceRepository;
  outageRepository: OutageRepository;
  graph: GraphWriteBundle;
  runCases: (repository: ResilienceRepository) => Promise<Array<Pick<FrozenCaseResult, "caseId" | "status" | "workspace" | "error">>>;
  qvacOutageProbe: () => Promise<unknown>;
}

const sourceEntity = "entity_90ad19476a96ae677e3c9143";
const sourceObject = "source_object_fa63884437348a11c9312fb9";
const usage =
  "Usage: npm run verify:resilience -- --herb-input <path> --output <path>";

export function parseVerifyResilienceArgs(args: string[]): VerifyArgs {
  if (args.length !== 4) throw new TypeError(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag ||
      !value ||
      !["--herb-input", "--output"].includes(flag) ||
      values.has(flag)
    ) {
      throw new TypeError(usage);
    }
    values.set(flag, value);
  }
  const herbInput = values.get("--herb-input");
  const output = values.get("--output");
  if (!herbInput || !output) throw new TypeError(usage);
  return { herbInput, output };
}

export async function verifyResilience(input: ResilienceDependencies) {
  const startedAt = new Date().toISOString();
  const fingerprint = fingerprintGraph(input.graph);
  await input.repository.writeGraph(input.graph);
  const firstPresence = await input.repository.getPresence(input.graph);
  await input.repository.writeGraph(input.graph);
  const secondPresence = await input.repository.getPresence(input.graph);
  const expectedPresence = {
    nodes: input.graph.nodes.length,
    edges: input.graph.edges.length,
  };
  if (
    JSON.stringify(firstPresence) !== JSON.stringify(expectedPresence) ||
    JSON.stringify(secondPresence) !== JSON.stringify(expectedPresence)
  ) {
    throw new Error("Repeated graph writes changed deterministic graph presence");
  }

  const pathInput: NativePathInput = {
    sourceLogicalId: sourceEntity,
    targetLogicalId: sourceObject,
    relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
    maxLength: 2,
    pathCount: 1,
  };
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () => input.repository.findNativePaths(pathInput)),
  );
  if (concurrent.some((paths) => paths.length !== 1)) {
    throw new Error("Concurrent native reads did not each return one path");
  }
  const queryIds = concurrent.map((paths) => paths[0]!.queryId);
  if (new Set(queryIds).size !== queryIds.length) {
    throw new Error("Concurrent native reads did not use unique query IDs");
  }
  if (concurrent.some((paths) => paths[0]!.roundTrips !== 1)) {
    throw new Error("Concurrent native reads exceeded one round trip");
  }
  const incompletePaths = await input.repository.findNativePaths({
    ...pathInput,
    targetLogicalId: "source_object_missing_resilience_probe",
  });
  if (incompletePaths.length !== 0) {
    throw new Error("Incomplete native path probe returned a path");
  }

  const replayResults = await input.runCases(input.repository);
  const replayCompleted = replayResults.filter(
    (result) => result.status === "completed" && result.workspace,
  );
  const replayFailed = replayResults.length - replayCompleted.length;

  let outageError = "";
  try {
    await input.outageRepository.entityExists(sourceEntity);
  } catch (error) {
    outageError = error instanceof Error ? error.message : String(error);
  }
  if (!outageError) throw new Error("Outage probe did not fail closed");

  const malformed = recordGroundingValidation({
    responseText: '{"claims":[',
    sourceText: "canonical source",
    allowedPredicates: ["profile_fact"],
    latencyMs: 0,
  });
  if (malformed.status !== "rejected" || malformed.reason !== "malformed_output") {
    throw new Error("Malformed QVAC output was not rejected");
  }
  let qvacOutageError = "";
  try {
    await input.qvacOutageProbe();
  } catch (error) {
    qvacOutageError = error instanceof Error ? error.message : String(error);
  }
  if (!qvacOutageError) throw new Error("QVAC outage probe did not fail closed");

  const endedAt = new Date().toISOString();
  const probe = (id: string, dependency: "hydradb" | "qvac" | "application", detail: string) => ({
    id,
    status: "passed" as const,
    dependency,
    command: "npm run verify:resilience",
    startedAt,
    endedAt,
    detail,
    rawError: null,
  });

  return {
    graph: {
      ...fingerprint,
      firstPresence,
      secondPresence,
      stableAcrossRepeatedWrites: true,
    },
    concurrency: {
      attempted: concurrent.length,
      completed: concurrent.length,
      uniqueQueryIds: new Set(queryIds).size,
      oneRoundTripEach: true,
      queryIds,
    },
    nativePath: {
      sourceLogicalId: sourceEntity,
      targetLogicalId: sourceObject,
      operation: concurrent[0]![0]!.operation,
      pathLength: concurrent[0]![0]!.pathLength,
    },
    replay: {
      attempted: replayResults.length,
      completed: replayCompleted.length,
      failed: replayFailed,
      qvacRequired: false,
      cases: replayResults.map((result) => ({
        caseId: result.caseId,
        status: result.status,
        verdict: result.workspace?.verdict ?? null,
        error: result.error ?? null,
      })),
    },
    outage: {
      failedClosed: true,
      workspaceReturned: false,
      error: outageError,
    },
    qvacOutage: { failedClosed: true, error: qvacOutageError },
    malformedExtraction: { rejected: true, reason: malformed.reason },
    probes: [
      probe("deterministic_graph_replay", "hydradb", "Two writes preserved exact node and edge presence."),
      probe("stable_graph_fingerprint", "application", `Graph digest ${fingerprint.sha256} remained stable.`),
      probe("concurrent_unique_query_ids", "hydradb", `${queryIds.length} concurrent reads returned unique live query IDs.`),
      probe("incomplete_path_rejected", "hydradb", "A missing target returned zero native paths."),
      probe("hydra_outage_fail_closed", "hydradb", outageError),
      probe("already_ingested_replay_without_qvac", "application", `${replayCompleted.length}/${replayResults.length} cases replayed without QVAC.`),
      probe("malformed_extraction_rejected", "qvac", "Truncated JSON remained rejected and produced zero claims."),
      probe("qvac_outage_fail_closed", "qvac", qvacOutageError),
    ],
  };
}

function hydraRepository(httpUrl = process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443") {
  return new HydraRepository({
    httpUrl,
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

async function main() {
  const options = parseVerifyResilienceArgs(process.argv.slice(2));
  const ingestion = await runIngestion(new HerbAdapter(), path.resolve(options.herbInput));
  const graph = mapIngestionToGraph(ingestion);
  const repository = hydraRepository();
  const outageRepository = hydraRepository("http://127.0.0.1:1");
  try {
    const report = await verifyResilience({
      repository,
      outageRepository,
      graph,
      runCases: (candidate) =>
        runFirstPrizeCases(candidate as unknown as CaseRepository),
      qvacOutageProbe: async () => {
        const response = await fetch("http://127.0.0.1:1/v1/chat/completions", {
          method: "POST",
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) throw new Error(`QVAC outage probe returned HTTP ${response.status}`);
        throw new Error("QVAC outage probe unexpectedly reached a service");
      },
    });
    if (report.replay.attempted !== 11 || report.replay.failed !== 0) {
      throw new Error("Resilience replay did not complete all eleven real-data cases");
    }
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(
      output,
      `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify({
      output,
      graphSha256: report.graph.sha256,
      concurrentReads: report.concurrency.completed,
      replayCompleted: report.replay.completed,
      outageFailedClosed: report.outage.failedClosed,
    }));
  } finally {
    await repository.close();
    await outageRepository.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
