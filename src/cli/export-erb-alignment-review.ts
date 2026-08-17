import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAlignmentAudit } from "@/alignment/build-audit";
import { observeErbSchema } from "@/alignment/observe-erb-schema";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";

interface Args { input: string; output: string }
const usage = "Usage: npm run export:erb-alignment-review -- --input <path> --output <path>";

export function parseExportErbAlignmentReviewArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--input" && flag !== "--output")) throw new TypeError(usage);
    if (flag === "--input") values.input = value;
    if (flag === "--output") values.output = value;
  }
  if (!values.input || !values.output) throw new TypeError(usage);
  return values as Args;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const options = parseExportErbAlignmentReviewArgs(process.argv.slice(2));
  const ingestion = await runIngestion(new ErbAdapter(), options.input);
  if (ingestion.rejected.length > 0) throw new Error("Alignment review input contains rejected records");
  const audit = buildAlignmentAudit(ingestion.records, observeErbSchema(ingestion.records));
  const terms = new Map(audit.sourceTerms.map((term) => [term.id, term]));
  const ontology = new Map(audit.ontologyTerms.map((term) => [term.id, term]));
  const candidates = audit.decisions.map((decision) => {
    const source = terms.get(decision.sourceTermId);
    const target = ontology.get(decision.candidateOntologyTermId);
    if (!source || !target) throw new TypeError(`Incomplete review candidate ${decision.id}`);
    return {
      sourceTermId: source.id,
      sourceSystem: source.sourceSystem,
      objectType: source.objectType,
      surface: source.surface,
      normalizedSurface: source.normalizedSurface,
      contextualRole: source.contextualRole,
      candidateOntologyTermId: target.id,
      candidateName: target.name,
      candidateDomain: target.domain,
      candidateRange: target.range,
      evidenceObservationIds: decision.evidenceObservationIds,
    };
  }).sort((left, right) => left.sourceTermId.localeCompare(right.sourceTermId) || left.candidateOntologyTermId.localeCompare(right.candidateOntologyTermId));
  const artifact = {
    schemaVersion: 1,
    dataset: "Enterprise RAG Bench",
    labelBlind: true,
    records: ingestion.records.length,
    sourceSystems: [...new Set(ingestion.records.map((record) => record.sourceSystem))].sort(),
    sourceTerms: audit.sourceTerms.length,
    mappings: candidates.length,
    runtimeDecisionDigest: sha256(audit.decisions.map((decision) => ({ id: decision.id, inputDigest: decision.inputDigest })).sort((a, b) => a.id.localeCompare(b.id))),
    candidates,
  };
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, mappings: candidates.length, sourceTerms: audit.sourceTerms.length, sourceSystems: artifact.sourceSystems.length, labelBlind: true }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
