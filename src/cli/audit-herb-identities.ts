import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HydraRepository } from "@/hydra/client";
import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { input: string; output: string }
const usage = "Usage: npm run audit:herb-identities -- --input <path> --output <path>";

export function parseAuditHerbIdentityArgs(args: string[]): Args {
  const result: Partial<Args> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--input" && flag !== "--output")) throw new TypeError(usage);
    if (flag === "--input") result.input = value;
    if (flag === "--output") result.output = value;
  }
  if (!result.input || !result.output) throw new TypeError(usage);
  return result as Args;
}

function repository(): HydraRepository {
  return new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

async function main(): Promise<void> {
  const options = parseAuditHerbIdentityArgs(process.argv.slice(2));
  const ingestion = await runIngestion(new HerbAdapter(), options.input);
  if (ingestion.rejected.length > 0) throw new Error("HERB identity input contains rejected records");
  const accepted = ingestion.resolution.decisions.filter((decision) => decision.status === "accepted");
  const hardNegatives = ingestion.resolution.decisions.filter((decision) =>
    decision.status === "rejected" && decision.constraints.includes("employee_id_conflict"),
  );
  const fuzzyCandidates = ingestion.resolution.decisions.filter((decision) =>
    decision.signals.some((signal) => signal.kind === "name_similarity"),
  );
  const positive = accepted.find((decision) =>
    decision.signals.some((signal) => signal.kind === "external_id_exact"),
  );
  const negative = hardNegatives[0];
  if (!positive || !negative) throw new Error("HERB lacks required positive and hard-negative identity pairs");
  const graph = mapIngestionToGraph(ingestion);
  const hydra = repository();
  try {
    await hydra.writeGraph(graph);
    await hydra.writeGraph(graph);
    const [positivePath, negativePath] = await Promise.all([
      hydra.findIdentityDecision(positive.id),
      hydra.findIdentityDecision(negative.id),
    ]);
    if (!positivePath || positivePath.status !== "accepted" || !negativePath || !negativePath.constraintKinds.includes("employee_id_conflict")) {
      throw new Error("HydraDB identity traversal is incomplete");
    }
    const describePair = (ids: [string, string]) => ids.map((id) => {
      const record = ingestion.records.find((candidate) => candidate.id === id);
      if (!record) throw new Error(`Missing identity source object ${id}`);
      return {
        sourceObjectId: record.id,
        sourceNativeId: record.sourceNativeId,
        sourceObjectType: record.sourceObjectType,
        displayName: String(record.fields.name ?? "Unknown"),
        employeeId: String(record.fields.employeeId ?? record.sourceNativeId),
      };
    });
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dataset: { name: "Salesforce HERB", license: "CC BY-NC 4.0; research-use limitations apply", records: ingestion.records.length },
      trial: {
        acceptedExactLinks: accepted.length,
        sameNameCandidates: fuzzyCandidates.length,
        hardNegativePairs: hardNegatives.length,
        sourceTruceFalseMerges: accepted.filter((decision) => decision.constraints.includes("employee_id_conflict")).length,
      },
      ablations: {
        exactOnly: { mergedPairs: accepted.length },
        naiveFuzzyName: { mergedPairs: fuzzyCandidates.length, knownHardConstraintViolations: fuzzyCandidates.filter((decision) => decision.constraints.includes("employee_id_conflict")).length },
        sourceTruce: { mergedPairs: accepted.length, blockedHardNegatives: hardNegatives.length },
      },
      examples: {
        accepted: { decision: positive, sources: describePair(positive.candidateSourceObjectIds), hydraPath: positivePath },
        rejected: { decision: negative, sources: describePair(negative.candidateSourceObjectIds), hydraPath: negativePath },
      },
      hydra: {
        implementation: "HydraDB OSS 0.1.0",
        traversal: "SourceObject->HAS_IDENTITY->Identity; ResolutionDecision->SUPPORTED_BY->ResolutionSignal; ResolutionDecision->BLOCKED_BY->ResolutionConstraint",
        idempotentWriteCount: 2,
        graph: { nodes: graph.nodes.length, edges: graph.edges.length },
      },
    };
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, ...artifact.trial, graph: artifact.hydra.graph }));
  } finally {
    await hydra.close();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
