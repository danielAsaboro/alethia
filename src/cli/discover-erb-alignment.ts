import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAlignmentAudit, type AlignmentObservationSpec } from "@/alignment/build-audit";
import { evaluateAlignmentDecisions, parseAlignmentAuditLabels } from "@/alignment/evaluate-alignments";
import { HydraRepository } from "@/hydra/client";
import { mapEvidenceSystemToGraph } from "@/hydra/evidence-graph";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { input: string; manifest: string; labels: string; output: string }
const usage = "Usage: npm run discover:erb-alignment -- --input <path> --manifest <path> --labels <path> --output <path>";

export function parseDiscoverAlignmentArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--input": "input", "--manifest": "manifest", "--labels": "labels", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]];
    const value = args[index + 1];
    if (!key || !value) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.input || !values.manifest || !values.labels || !values.output) throw new TypeError(usage);
  return values as Args;
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
  const options = parseDiscoverAlignmentArgs(process.argv.slice(2));
  const [ingestion, rawManifest] = await Promise.all([
    runIngestion(new ErbAdapter(), options.input),
    readFile(path.resolve(options.manifest), "utf8"),
  ]);
  if (ingestion.rejected.length > 0) throw new Error("Alignment input contains rejected canonical records");
  const manifest = JSON.parse(rawManifest) as {
    datasetUrl: string;
    outputSha256: string;
    missingDocumentIds: string[];
    alignmentObservations: AlignmentObservationSpec[];
  };
  if (manifest.missingDocumentIds.length > 0 || manifest.alignmentObservations.length === 0) {
    throw new Error("Alignment acquisition manifest is incomplete");
  }
  const audit = buildAlignmentAudit(ingestion.records, manifest.alignmentObservations);
  // Labels are deliberately loaded only after the runtime audit decisions exist.
  const rawLabels = await readFile(path.resolve(options.labels), "utf8");
  const labels = parseAlignmentAuditLabels(JSON.parse(rawLabels));
  const evaluation = evaluateAlignmentDecisions(audit.decisions, labels);
  const graph = mapEvidenceSystemToGraph({
    claims: [], observations: [], conflicts: [], policies: [],
    sources: ingestion.records.map((record) => ({
      id: record.id,
      sourceSystem: record.sourceSystem,
      sourceNativeId: record.sourceNativeId,
      payloadDigest: record.payloadDigest,
    })),
    alignment: audit,
  });
  const hydra = repository();
  try {
    await hydra.writeGraph(graph);
    await hydra.writeGraph(graph);
    const presence = await hydra.getPresence(graph);
    const traversals = Object.fromEntries(await Promise.all(
      audit.sourceTerms.map(async (term) => [term.id, await hydra.findAlignmentDecisions(term.id)] as const),
    ));
    const accepted = audit.decisions.filter((decision) => decision.status === "accepted").length;
    const rejected = audit.decisions.filter((decision) => decision.status === "rejected").length;
    if (presence.nodes !== graph.nodes.length || presence.edges !== graph.edges.length) {
      throw new Error("HydraDB alignment round trip is incomplete");
    }
    if (Object.values(traversals).some((rows) => rows.length !== 2)) {
      throw new Error("HydraDB alignment decision traversal is incomplete");
    }
    const liveDecisions = new Map(Object.values(traversals).flat().map((decision) => [decision.decisionId, decision]));
    for (const label of labels) {
      const decision = audit.decisions.find((item) => item.sourceTermId === label.sourceTermId && item.candidateOntologyTermId === label.candidateOntologyTermId);
      const live = decision ? liveDecisions.get(decision.id) : undefined;
      if (!decision || !live || live.status !== decision.status || live.inputDigest !== decision.inputDigest) {
        throw new Error(`HydraDB audited alignment decision is incomplete: ${label.sourceTermId}`);
      }
    }
    const artifact = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      dataset: { url: manifest.datasetUrl, inputSha256: manifest.outputSha256, records: ingestion.records.length },
      leakageFirewall: "Acquisition exports source schema observations and document IDs only; evaluation labels are absent.",
      labels: {
        sha256: createHash("sha256").update(rawLabels).digest("hex"),
        auditedMappings: labels.length,
        loadedAfterRuntimeDecisions: true,
      },
      sourceTerms: audit.sourceTerms,
      ontologyTerms: audit.ontologyTerms,
      rules: audit.rules,
      decisions: audit.decisions,
      baseline: audit.baseline,
      evaluation,
      hydra: {
        implementation: "HydraDB OSS 0.1.0",
        traversal: "SourceObject->OBSERVED_AS->SourceSchemaTerm; AlignmentDecision->CONSIDERS->SourceSchemaTerm and OntologyTerm; SourceSchemaTerm->MAPS_TO->OntologyTerm; AlignmentDecision->REJECTED_MAPPING->OntologyTerm",
        idempotentWriteCount: 2,
        presence,
        traversals,
      },
    };
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, sourceTerms: audit.sourceTerms.length, accepted, rejected, accuracy: evaluation.accuracy, presence }));
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
