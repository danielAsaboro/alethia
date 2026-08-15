import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  HydraRepository,
  type ClientPathBaseline,
  type GraphAlignmentDecision,
  type GraphClaimEvidence,
  type HydraMultiPathResult,
  type HydraPathProof,
  type NativeMultiPathInput,
  type NativePathInput,
} from "@/hydra/client";

interface MeasureArgs { output: string }

interface MeasureRepository {
  findClaimEvidence(entityLogicalId: string, predicate?: string): Promise<GraphClaimEvidence[]>;
  findAlignmentDecisions(sourceTermId: string): Promise<GraphAlignmentDecision[]>;
  findNativePaths(input: NativePathInput): Promise<HydraPathProof[]>;
  findClientPathBaseline(input: NativePathInput): Promise<ClientPathBaseline>;
  findNativeMultiPaths(input: NativeMultiPathInput): Promise<HydraMultiPathResult>;
}

const entityLogicalId = "entity_90ad19476a96ae677e3c9143";
const fileOwnerTerm = "source_term_390378ec7210fb25b3662ba0";
const opportunityOwnerTerm = "source_term_0354c371ffe861934bed28e6";
const usage = "Usage: npm run measure:hydra-leverage -- --output <path>";

export function parseMeasureHydraLeverageArgs(args: string[]): MeasureArgs {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new TypeError(usage);
  }
  return { output: args[1] };
}

function accepted(rows: GraphAlignmentDecision[], sourceTermId: string) {
  const matches = rows.filter((row) => row.status === "accepted");
  if (matches.length !== 1) {
    throw new Error(`Expected one accepted alignment for ${sourceTermId}`);
  }
  return matches[0]!;
}

export async function measureHydraLeverage(repository: MeasureRepository) {
  const [claims, fileRows, opportunityRows] = await Promise.all([
    repository.findClaimEvidence(entityLogicalId, "has_role"),
    repository.findAlignmentDecisions(fileOwnerTerm),
    repository.findAlignmentDecisions(opportunityOwnerTerm),
  ]);
  const role = [...claims].sort((left, right) =>
    left.claimLogicalId.localeCompare(right.claimLogicalId),
  )[0];
  if (!role) throw new Error("Hydra leverage role evidence is missing");
  const pathInput: NativePathInput = {
    sourceLogicalId: entityLogicalId,
    targetLogicalId: role.sourceLogicalId,
    relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
    maxLength: 2,
    pathCount: 1,
  };
  const [nativePaths, client] = await Promise.all([
    repository.findNativePaths(pathInput),
    repository.findClientPathBaseline(pathInput),
  ]);
  if (nativePaths.length !== 1 || !client.found) {
    throw new Error("Hydra leverage paths did not resolve the same endpoints");
  }
  const native = nativePaths[0]!;
  if (
    client.pathLogicalIds[0] !== pathInput.sourceLogicalId ||
    client.pathLogicalIds[client.pathLogicalIds.length - 1] !== pathInput.targetLogicalId
  ) {
    throw new Error("Client baseline path endpoints do not match native path endpoints");
  }
  const file = accepted(fileRows, fileOwnerTerm);
  const opportunity = accepted(opportunityRows, opportunityOwnerTerm);
  const multi = await repository.findNativeMultiPaths({
    sourceLabel: "SourceSchemaTerm",
    sourceLogicalIds: [fileOwnerTerm, opportunityOwnerTerm],
    targetLabel: "OntologyTerm",
    targetLogicalIds: [file.ontologyTermId, opportunity.ontologyTermId],
    relationshipTypes: ["MAPS_TO"],
    maxLength: 1,
    pathCount: 1,
  });
  if (multi.pathCount !== multi.pairCount) {
    throw new Error("Hydra MSpaths did not return exactly one path for every indexed pair");
  }
  const latencyRatio = native.latencyMs > 0 ? client.latencyMs / native.latencyMs : null;
  return {
    scope: "local single-host measurement; not a universal speedup claim",
    singlePair: {
      operation: native.operation,
      sourceLogicalId: pathInput.sourceLogicalId,
      targetLogicalId: pathInput.targetLogicalId,
      pathCount: nativePaths.length,
      pathLength: native.pathLength,
      nativeLatencyMs: native.latencyMs,
      nativeRoundTrips: native.roundTrips,
      clientLatencyMs: client.latencyMs,
      clientRoundTrips: client.roundTrips,
      avoidedRoundTrips: client.roundTrips - native.roundTrips,
      clientToNativeLatencyRatio: latencyRatio,
    },
    multiplePairs: {
      operation: multi.operation,
      pairCount: multi.pairCount,
      pathCount: multi.pathCount,
      latencyMs: multi.latencyMs,
      roundTrips: multi.roundTrips,
      queryId: multi.queryId,
    },
  };
}

async function main() {
  const options = parseMeasureHydraLeverageArgs(process.argv.slice(2));
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
  try {
    const report = await measureHydraLeverage(repository);
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await repository.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
