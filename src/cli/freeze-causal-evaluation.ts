import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { freezeCausalRuntime } from "@/evaluation/causal-runtime";
import { HydraRepository } from "@/hydra/client";

interface Args { extractions: string; promotions: string; corpus: string; output: string }
const usage = "Usage: npm run causal:freeze -- --extractions <json> --promotions <json> --corpus <jsonl> --output <json>";

function parseArgs(args: string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--extractions", "--promotions", "--corpus", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const extractions = values.get("--extractions"), promotions = values.get("--promotions"), corpus = values.get("--corpus"), output = values.get("--output");
  if (!extractions || !promotions || !corpus || !output) throw new TypeError(usage);
  return { extractions, promotions, corpus, output };
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

function extractorRevision(value: string): number {
  const match = value.match(/:v(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [extractionBytes, promotionBytes, corpusBytes] = await Promise.all([
    readFile(path.resolve(args.extractions)),
    readFile(path.resolve(args.promotions)),
    readFile(path.resolve(args.corpus)),
  ]);
  const extractionArtifact = JSON.parse(extractionBytes.toString("utf8")) as { cases?: Array<{ questionId?: unknown; question?: unknown }> };
  const promotionArtifact = JSON.parse(promotionBytes.toString("utf8")) as { promotions?: Array<Record<string, unknown>> };
  if (!Array.isArray(extractionArtifact.cases) || !Array.isArray(promotionArtifact.promotions)) throw new TypeError("Causal source artifacts are malformed");
  const questions = new Map(extractionArtifact.cases.map((row) => [String(row.questionId), String(row.question)]));
  const promoted = promotionArtifact.promotions.filter((row) => row.status === "resolved" || row.status === "unresolved");
  if (promoted.length !== 19) throw new Error(`Expected 19 real promoted conflicts, observed ${promoted.length}`);
  const hydra = repository();
  try {
    const cases = [];
    const excludedNativeIds = new Set<string>();
    for (const promotion of promoted) {
      const caseId = String(promotion.questionId), conflictId = String(promotion.conflictId), entityId = String(promotion.entityId);
      const [decision, observations] = await Promise.all([
        hydra.findConflictDecision(conflictId),
        hydra.findObservationEvidence(entityId),
      ]);
      if (!decision || !decision.queryIds || decision.queryIds.length !== 2) throw new Error(`${caseId} lacks a live strong-consistency Hydra conflict receipt`);
      const relevant = decision.claimIds.map((claimId) => observations
        .filter((row) => row.claimLogicalId === claimId)
        .sort((left, right) => extractorRevision(right.extractorVersion) - extractorRevision(left.extractorVersion) || right.observationLogicalId.localeCompare(left.observationLogicalId))[0])
        .filter((row) => row !== undefined);
      if (relevant.length !== 2) throw new Error(`${caseId} requires exactly two live grounded conflict observations`);
      relevant.forEach((row) => excludedNativeIds.add(row.sourceNativeId));
      const currentSourceObjectIds = decision.winningClaimId
        ? relevant.filter((row) => row.claimLogicalId === decision.winningClaimId).map((row) => row.sourceLogicalId)
        : [];
      const supersededSourceObjectIds = decision.winningClaimId
        ? relevant.filter((row) => row.claimLogicalId !== decision.winningClaimId).map((row) => row.sourceLogicalId)
        : [];
      cases.push({
        caseId,
        question: questions.get(caseId) ?? "",
        retrieved: relevant.map((row) => ({ id: row.sourceLogicalId, sourceSystem: row.sourceSystem, text: row.evidenceQuote })),
        graph: {
          verdict: decision.winningClaimId ? "SUPPORTED" as const : "DISPUTED" as const,
          currentSourceObjectIds,
          supersededSourceObjectIds,
          conflictSourceObjectIds: relevant.map((row) => row.sourceLogicalId),
          hydraQueryIds: decision.queryIds,
        },
      });
    }
    const corpusRows = corpusBytes.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const replacementSources = corpusRows
      .filter((row) => !excludedNativeIds.has(String(row.doc_id)))
      .map((row) => ({ id: `corpus_${String(row.doc_id)}`, sourceSystem: String(row.source_type), text: String(row.content) }));
    const datasetRevision = createHash("sha256").update(corpusBytes).digest("hex");
    const runtime = freezeCausalRuntime({ datasetRevision, seed: "causal-development-v1", cases, replacementSources });
    const output = path.resolve(args.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, cases: runtime.cases.length, hydraQueryReceipts: runtime.cases.reduce((sum, row) => sum + row.graph.hydraQueryIds.length, 0), labelFree: runtime.labelFree }));
  } finally {
    await hydra.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
