import { createHash } from "node:crypto";

import { stableId } from "@/domain/ids";
import { fingerprintGraph } from "@/evaluation/graph-fingerprint";
import type { GraphWriteBundle } from "@/hydra/client";
import type { IngestionBundle, JsonValue, NormalizedSourceObject } from "./source-adapter";

export interface IngestionLedgerRunInput {
  dataset: string;
  inputPath: string;
  inputSha256?: string;
  bundle: IngestionBundle;
  graph: GraphWriteBundle;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timestamps(fields: Record<string, JsonValue>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
    /(?:^|_)(?:created|updated|modified|timestamp|date|time)(?:$|_)/i.test(key) && (typeof value === "string" || typeof value === "number"),
  )) as Record<string, string | number>;
}

function recordKey(record: NormalizedSourceObject): string {
  return `${record.sourceSystem}\0${record.sourceNativeId}\0${record.payloadDigest}`;
}

export function mergeIngestionGraphs(graphs: GraphWriteBundle[]): GraphWriteBundle {
  const nodes = new Map<string, GraphWriteBundle["nodes"][number]>();
  const edges = new Map<string, GraphWriteBundle["edges"][number]>();
  for (const graph of graphs) {
    for (const node of graph.nodes) nodes.set(`${node.label}\0${node.logicalId}`, node);
    for (const edge of graph.edges) edges.set(edge.logicalId, edge);
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    edges: [...edges.values()].sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
  };
}

export function buildIngestionRunLedger(runs: IngestionLedgerRunInput[]) {
  if (runs.length === 0) throw new TypeError("Ingestion ledger requires at least one run");
  let accepted = 0, rejected = 0, skipped = 0, failed = 0;
  const acceptedRecords: Array<Record<string, unknown>> = [];
  const rejectedRecords: Array<Record<string, unknown>> = [];
  const sourceSystems = new Set<string>();
  const nativeVersions = new Map<string, Set<string>>();
  let nearDuplicateCandidates = 0, hardIdentityBlockers = 0, partialCoverage = 0, extractionGaps = 0;
  const runSummaries = [];
  const mutationIds: string[] = [];

  for (const run of runs) {
    const seen = new Set<string>();
    let runAccepted = 0, runSkipped = 0;
    for (const record of run.bundle.records) {
      sourceSystems.add(record.sourceSystem);
      const versions = nativeVersions.get(`${record.sourceSystem}\0${record.sourceNativeId}`) ?? new Set<string>();
      versions.add(record.payloadDigest);
      nativeVersions.set(`${record.sourceSystem}\0${record.sourceNativeId}`, versions);
      const key = recordKey(record);
      if (seen.has(key)) {
        skipped += 1;
        runSkipped += 1;
        continue;
      }
      seen.add(key);
      accepted += 1;
      runAccepted += 1;
      acceptedRecords.push({
        terminalStatus: "accepted",
        dataset: run.dataset,
        sourceSystem: record.sourceSystem,
        objectType: record.sourceObjectType,
        sourceNativeId: record.sourceNativeId,
        sourcePath: record.sourcePath,
        payloadDigest: record.payloadDigest,
        timestamps: timestamps(record.fields),
        adapterVersion: run.bundle.adapter.version,
        extractorVersions: [...new Set(run.bundle.extraction.claims.filter((claim) => claim.sourceObjectId === record.id).map((claim) => claim.extractorVersion))].sort(),
      });
    }
    const adapterFailed = run.bundle.coverage.some((slice) => slice.status === "failed");
    for (const item of run.bundle.rejected) {
      if (adapterFailed) failed += 1;
      else rejected += 1;
      rejectedRecords.push({
        terminalStatus: adapterFailed ? "failed" : "rejected",
        dataset: run.dataset,
        sourceNativeId: item.sourceNativeId ?? null,
        sourcePath: item.sourcePath,
        reason: item.reason,
        detail: item.detail,
        adapterVersion: run.bundle.adapter.version,
      });
    }
    nearDuplicateCandidates += run.bundle.resolution.decisions.filter((decision) => decision.signals.some((signal) => signal.kind === "name_similarity")).length;
    hardIdentityBlockers += run.bundle.resolution.decisions.filter((decision) => decision.constraints.some((constraint) => constraint.endsWith("_conflict"))).length;
    partialCoverage += run.bundle.coverage.filter((slice) => slice.status !== "complete").length;
    extractionGaps += run.bundle.extraction.gaps.length;
    const graphFingerprint = fingerprintGraph(run.graph);
    const inputSha256 = run.inputSha256 ?? canonicalDigest({ records: run.bundle.records.map((record) => record.payloadDigest), rejected: run.bundle.rejected.map((item) => item.id) });
    mutationIds.push(stableId("graph_mutation", { dataset: run.dataset, inputSha256, graphSha256: graphFingerprint.sha256, adapterVersion: run.bundle.adapter.version }));
    runSummaries.push({ dataset: run.dataset, inputPath: run.inputPath, inputSha256, adapter: run.bundle.adapter, counts: { accepted: runAccepted, rejected: adapterFailed ? 0 : run.bundle.rejected.length, skipped: runSkipped, failed: adapterFailed ? run.bundle.rejected.length : 0 }, coverageSliceIds: run.bundle.coverage.map((slice) => slice.id).sort(), graphFingerprint });
  }

  const graph = mergeIngestionGraphs(runs.map((run) => run.graph));
  const graphFingerprint = fingerprintGraph(graph);
  const counts = { accepted, rejected, skipped, failed };
  return {
    schemaVersion: 1,
    recordsAttempted: accepted + rejected + skipped + failed,
    counts,
    scope: {
      datasets: [...new Set(runs.map((run) => run.dataset))].sort(),
      sourceSystems: [...sourceSystems].sort(),
      distinctNativeObjects: nativeVersions.size,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
    },
    noise: {
      exactDuplicates: skipped,
      divergentNativeVersions: [...nativeVersions.values()].filter((versions) => versions.size > 1).length,
      nearDuplicateCandidates,
      hardIdentityBlockers,
      partialOrFailedCoverageSlices: partialCoverage,
      extractionGaps,
      misfiledRelations: graph.edges.filter((edge) => edge.type === "MISFILED_AS").length,
    },
    acceptedRecords: acceptedRecords.sort((left, right) => String(left.sourcePath).localeCompare(String(right.sourcePath))),
    rejectedRecords: rejectedRecords.sort((left, right) => String(left.sourcePath).localeCompare(String(right.sourcePath))),
    runs: runSummaries,
    mutationIdKind: "deterministic_graph_bundle_v1",
    mutationIds: mutationIds.sort(),
    graphFingerprint,
  };
}
