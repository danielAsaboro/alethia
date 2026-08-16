import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { rankCandidateDocuments, type CandidateDocument } from "@/cli/extract-erb-conflicts";
import { stableId } from "@/domain/ids";
import type { CompletedEvaluationAttemptV2, EvaluationAttemptV2 } from "@/evaluation/contract";
import { assertFrozenHoldout, runFrozenHoldout, type FrozenHoldout } from "@/evaluation/holdout";
import { HydraRepository, type GraphWriteBundle } from "@/hydra/client";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import { GROUNDED_CLAIMS_PROMPT_VERSION, mapQvacClaimToGraph, QvacClient, QvacExtractionError } from "@/qvac/client";
import { qvacRuntimeModel } from "@/qvac/model";

interface Args { freeze: string; documents: string; output: string }
const usage = "Usage: tsx src/cli/execute-erb-holdout.ts --freeze <frozen.json> --documents <canonical.jsonl> --output <executed.json>";

export function parseExecuteErbHoldoutArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--freeze": "freeze", "--documents": "documents", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || values[key]) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.freeze || !values.documents || !values.output) throw new TypeError(usage);
  return values as Args;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

async function documentsFrom(pathname: string): Promise<CandidateDocument[]> {
  const documents: CandidateDocument[] = [];
  for await (const event of new ErbAdapter().read(pathname)) {
    if (event.type !== "record") continue;
    const title = event.record.fields.title, body = event.record.fields.body;
    if (typeof title !== "string" || typeof body !== "string") throw new TypeError(`Canonical record lacks text: ${event.record.id}`);
    documents.push({ sourceObjectId: event.record.id, sourceNativeId: event.record.sourceNativeId, sourceSystem: event.record.sourceSystem, title, body, payloadDigest: event.record.payloadDigest });
  }
  return documents;
}

function executionConfig(value: Record<string, unknown>): { sourceSystems: string[]; maximumDocuments: number; coverageState: "complete" | "partial" } {
  if (!Array.isArray(value.sourceSystems) || value.sourceSystems.some((item) => typeof item !== "string") || !Number.isSafeInteger(value.maximumDocuments) || Number(value.maximumDocuments) < 1) {
    throw new TypeError("Holdout case has invalid retrieval execution configuration");
  }
  return {
    sourceSystems: value.sourceSystems as string[],
    maximumDocuments: Number(value.maximumDocuments),
    coverageState: value.coverageState === "complete" ? "complete" : "partial",
  };
}

async function main(): Promise<void> {
  const args = parseExecuteErbHoldoutArgs(process.argv.slice(2));
  const [freezeBytes, documentBytes] = await Promise.all([readFile(path.resolve(args.freeze), "utf8"), readFile(path.resolve(args.documents))]);
  const frozen = JSON.parse(freezeBytes) as FrozenHoldout;
  assertFrozenHoldout(frozen);
  if (sha256(documentBytes) !== frozen.acquisitionDigest) throw new TypeError("Canonical acquisition digest does not match frozen holdout");
  const runtimeModel = qvacRuntimeModel(frozen.model.alias);
  if (runtimeModel.modelSha256 !== frozen.model.sha256) throw new TypeError("Pinned QVAC model digest does not match frozen holdout");
  if (frozen.extractionPromptVersion !== GROUNDED_CLAIMS_PROMPT_VERSION) throw new TypeError("Grounded extraction prompt version does not match frozen holdout");
  const documents = await documentsFrom(path.resolve(args.documents));
  const hydra = repository();
  const qvac = new QvacClient();
  const attempts: EvaluationAttemptV2[] = [];
  const rawExtractions: unknown[] = [];
  try {
    for (const runtimeCase of frozen.runtime.cases) {
      const started = performance.now();
      let rejected = 0;
      try {
        const config = executionConfig(runtimeCase.execution);
        const selected = rankCandidateDocuments({ questionId: runtimeCase.id, question: runtimeCase.question, questionType: "conflicting_info", sourceTypes: config.sourceSystems, maximumDocuments: config.maximumDocuments }, documents, config.maximumDocuments);
        const entityId = stableId("entity", { holdoutCaseId: runtimeCase.id });
        const graph: GraphWriteBundle = {
          nodes: [{ logicalId: entityId, label: "Entity", properties: { holdoutCaseId: runtimeCase.id } }],
          edges: [],
        };
        for (const document of selected) {
          graph.nodes.push({ logicalId: document.sourceObjectId, label: "SourceObject", properties: { sourceSystem: document.sourceSystem, nativeId: document.sourceNativeId, payloadDigest: document.payloadDigest } });
          try {
            const extraction = await qvac.extractClaims({
              subjectEntityId: entityId,
              sourceObjectId: document.sourceObjectId,
              sourceSystem: document.sourceSystem,
              sourceText: document.body,
              predicates: [{ predicate: "answer_fact", description: runtimeCase.question }],
            });
            rawExtractions.push({ caseId: runtimeCase.id, sourceNativeId: document.sourceNativeId, status: "accepted", responseText: extraction.responseText, evidenceQuotes: extraction.evidenceQuotes });
            for (const claim of extraction.claims) {
              const mapped = mapQvacClaimToGraph(claim, extraction.evidenceQuotes[claim.id]!);
              graph.nodes.push(...mapped.nodes);
              graph.edges.push(...mapped.edges);
            }
          } catch (error) {
            rejected += 1;
            rawExtractions.push({ caseId: runtimeCase.id, sourceNativeId: document.sourceNativeId, status: "rejected", error: error instanceof Error ? error.message : String(error), responseText: error instanceof QvacExtractionError ? error.responseText : "" });
          }
        }
        await hydra.writeGraph(graph);
        const live = await hydra.findClaimEvidence(entityId, "answer_fact");
        const proofs = await Promise.all(live.map(async (claim) => (await hydra.findExactPath({ nodeLogicalIds: [entityId, claim.claimLogicalId, claim.sourceLogicalId], relationshipTypes: ["ASSERTS", "SUPPORTED_BY"] }))[0]!));
        const distinctValues = new Set(live.map((claim) => claim.object.kind === "literal" ? String(claim.object.value) : claim.object.entityId));
        const verdict = live.length > 0 ? (runtimeCase.category === "conflict" && distinctValues.size > 1 ? "DISPUTED" : "SUPPORTED") : config.coverageState === "complete" ? "NOT_FOUND" : "UNKNOWN";
        const attempt: CompletedEvaluationAttemptV2 = {
          schemaVersion: 2,
          caseId: runtimeCase.id,
          status: "completed",
          latencyMs: Number((performance.now() - started).toFixed(3)),
          verdict,
          facts: [...distinctValues].map((value) => ({ kind: "text" as const, value })),
          evidenceDocumentIds: [...new Set(live.map((claim) => claim.sourceNativeId))],
          relationships: live.length > 0 ? ["ASSERTS", "SUPPORTED_BY"] : [],
          coverageState: config.coverageState,
          conflictState: runtimeCase.category === "conflict" ? (distinctValues.size > 1 ? "unresolved" : "none") : "not_applicable",
          identityState: "not_applicable",
          alignmentState: "not_applicable",
          grounding: { accepted: live.length, rejected },
          graphProofs: proofs.map((proof) => ({ queryId: proof.queryId, live: true, relationshipTypes: proof.relationships.map((item) => item.type), pathLength: proof.pathLength, sourceLabel: proof.nodes[0]?.labels[0], targetLabel: proof.nodes.at(-1)?.labels[0] })),
        };
        attempts.push(attempt);
      } catch (error) {
        attempts.push({ schemaVersion: 2, caseId: runtimeCase.id, status: "failed", latencyMs: Number((performance.now() - started).toFixed(3)), error: error instanceof Error ? error.message : String(error) });
      }
    }
    const executed = runFrozenHoldout(frozen, attempts, { runtime: { provider: "QVAC", model: runtimeModel, extractionPromptVersion: frozen.extractionPromptVersion }, documents: { count: documents.length, sourceSystems: [...new Set(documents.map((item) => item.sourceSystem))].sort() }, rawExtractions });
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(executed, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, attempts: attempts.length, completed: attempts.filter((item) => item.status === "completed").length, failed: attempts.filter((item) => item.status === "failed").length, executionDigest: executed.executionDigest }));
  } finally {
    await hydra.close();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
