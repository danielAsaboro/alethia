import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HydraRepository, type GraphWriteBundle } from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface HydraSmokeArgs {
  input: string;
  evidence: string;
}

const usage =
  "Usage: npm run hydra:smoke -- --input <path> --evidence <path>";

export function parseHydraSmokeArgs(args: string[]): HydraSmokeArgs {
  let input: string | undefined;
  let evidence: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--input" && flag !== "--evidence")) {
      throw new TypeError(usage);
    }
    if (flag === "--input") input = value;
    if (flag === "--evidence") evidence = value;
  }
  if (!input || !evidence) throw new TypeError(usage);
  return { input, evidence };
}

function selectEvidencePathSample(
  graph: GraphWriteBundle,
  sourceLogicalId: string,
  entityLogicalId: string,
  claimLogicalId: string,
): GraphWriteBundle {
  const wantedNodes = new Set([
    sourceLogicalId,
    entityLogicalId,
    claimLogicalId,
  ]);
  const wantedEdges = graph.edges.filter(
    (edge) =>
      (edge.type === "ASSERTS" &&
        edge.sourceLogicalId === entityLogicalId &&
        edge.targetLogicalId === claimLogicalId) ||
      (edge.type === "SUPPORTED_BY" &&
        edge.sourceLogicalId === claimLogicalId &&
        edge.targetLogicalId === sourceLogicalId),
  );
  return {
    nodes: graph.nodes.filter((node) => wantedNodes.has(node.logicalId)),
    edges: wantedEdges,
  };
}

async function main(): Promise<void> {
  const options = parseHydraSmokeArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const ingestion = await runIngestion(new HerbAdapter(), options.input);
  const graph = mapIngestionToGraph(ingestion);
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });

  try {
    await repository.writeGraph(graph);
    const firstWriteMs = Math.round(performance.now() - start);
    const secondStart = performance.now();
    await repository.writeGraph(graph);
    const secondWriteMs = Math.round(performance.now() - secondStart);

    const source = ingestion.records.find(
      (record) =>
        record.sourceObjectType === "employee" &&
        record.sourceNativeId === "eid_01942cf0",
    );
    if (!source) throw new Error("Evidence source was not ingested");
    const entity = ingestion.resolution.entities.find((item) =>
      item.sourceObjectIds.includes(source.id),
    );
    if (!entity) throw new Error("Evidence source was not resolved");
    const claim = ingestion.extraction.claims.find(
      (item) =>
        item.subjectEntityId === entity.id &&
        item.sourceObjectId === source.id &&
        item.predicate === "has_role",
    );
    if (!claim) throw new Error("Evidence claim was not extracted");

    const sample = selectEvidencePathSample(
      graph,
      source.id,
      entity.id,
      claim.id,
    );
    const samplePresence = await repository.getPresence(sample);
    const evidencePath = await repository.findEvidencePath(entity.id);
    if (samplePresence.nodes !== 3 || samplePresence.edges !== 2) {
      throw new Error(`HydraDB sample round trip was incomplete: ${JSON.stringify(samplePresence)}`);
    }
    if (evidencePath.length !== 3) {
      throw new Error("HydraDB evidence traversal returned no path");
    }

    const artifact = {
      startedAt,
      completedAt: new Date().toISOString(),
      hydra: {
        implementation: "hydra-db/hydradb graph-node",
        version: "0.1.0",
        image:
          "ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709",
        architecture: "arm64",
        transport: "authenticated HTTP OpenCypher",
      },
      ingestion: ingestion.summary,
      ontology: {
        canonicalEntities: ingestion.resolution.entities.length,
        resolutionDecisions: ingestion.resolution.decisions.length,
        claims: ingestion.extraction.claims.length,
        extractionGaps: ingestion.extraction.gaps.length,
        graphNodesSubmitted: graph.nodes.length,
        graphEdgesSubmitted: graph.edges.length,
      },
      idempotency: { firstWriteMs, secondWriteMs },
      samplePresence,
      evidencePath,
    };
    const evidencePathname = path.resolve(options.evidence);
    await mkdir(path.dirname(evidencePathname), { recursive: true });
    await writeFile(
      evidencePathname,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify({ evidencePathname, ...artifact.ontology, samplePresence }));
  } finally {
    await repository.close();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
