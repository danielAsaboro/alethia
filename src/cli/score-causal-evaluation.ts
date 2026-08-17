import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CausalCaseInput } from "@/evaluation/causal-arms";
import { scoreCausalResults } from "@/evaluation/causal-score";
import { EvaluationJudgeMalformedOutputError, QvacEvaluationJudge } from "@/qvac/evaluation-judge";

interface Args { results: string; runtime: string; labels: string; extractions: string; output: string; judgmentsFrom?: string }
const usage = "Usage: npm run causal:score -- --results <runtime-results.json> --runtime <runtime.json> --labels <questions.jsonl> --extractions <extractions.json> [--judgments-from <prior-scored.json>] --output <report.json>";

function parseArgs(args: string[]): Args {
  if (args.length !== 10 && args.length !== 12) throw new TypeError(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--results", "--runtime", "--labels", "--extractions", "--judgments-from", "--output"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const result = {
    results: values.get("--results"), runtime: values.get("--runtime"), labels: values.get("--labels"),
    extractions: values.get("--extractions"), output: values.get("--output"), judgmentsFrom: values.get("--judgments-from"),
  };
  if (!result.results || !result.runtime || !result.labels || !result.extractions || !result.output) throw new TypeError(usage);
  return result as Args;
}

function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function normalized(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Integrity ordering: runtime results and sealed runtime are validated before labels are opened.
  const [resultsBytes, runtimeBytes] = await Promise.all([readFile(path.resolve(args.results)), readFile(path.resolve(args.runtime))]);
  const resultsArtifact = JSON.parse(resultsBytes.toString("utf8")) as { runtimeSha256?: unknown; labelsOpened?: unknown; results?: Array<Record<string, unknown>> };
  const runtime = JSON.parse(runtimeBytes.toString("utf8")) as { labelFree?: unknown; cases?: CausalCaseInput[] };
  if (resultsArtifact.runtimeSha256 !== digest(runtimeBytes) || resultsArtifact.labelsOpened !== false || runtime.labelFree !== true || !Array.isArray(runtime.cases) || !Array.isArray(resultsArtifact.results)) {
    throw new TypeError("Causal runtime/result digest boundary failed before label opening");
  }
  const [labelsBytes, extractionBytes] = await Promise.all([readFile(path.resolve(args.labels)), readFile(path.resolve(args.extractions))]);
  const wanted = new Set(runtime.cases.map((row) => row.caseId));
  const labels = labelsBytes.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => wanted.has(String(row.question_id)));
  if (labels.length !== runtime.cases.length || labels.some((row) => row.question_type !== "conflicting_info" || !Array.isArray(row.expected_doc_ids) || !Array.isArray(row.answer_facts))) {
    throw new TypeError("Causal scorer labels do not exactly match the sealed runtime");
  }
  const extraction = JSON.parse(extractionBytes.toString("utf8")) as { cases?: Array<{ questionId?: unknown; extractions?: Array<Record<string, unknown>> }> };
  if (!Array.isArray(extraction.cases)) throw new TypeError("Causal extraction provenance is malformed");
  const nativeToSource = new Map<string, string>();
  const valuesByCaseSource = new Map<string, string>();
  for (const row of extraction.cases) for (const item of row.extractions ?? []) {
    const sourceObjectId = String(item.sourceObjectId), sourceNativeId = String(item.sourceNativeId);
    nativeToSource.set(sourceNativeId, sourceObjectId);
    const observation = item.observation as Record<string, unknown> | undefined;
    if (observation && typeof observation.value === "string") valuesByCaseSource.set(`${String(row.questionId)}\0${sourceObjectId}`, observation.value);
  }
  const scoreLabels = labels.map((row) => ({
    caseId: String(row.question_id),
    expectedDocumentIds: (row.expected_doc_ids as string[]).map((id) => nativeToSource.get(id)).filter((id): id is string => Boolean(id)),
  }));
  if (scoreLabels.some((row) => row.expectedDocumentIds.length === 0)) throw new Error("Expected native evidence could not be mapped to Hydra source objects");
  const labelById = new Map(labels.map((row) => [String(row.question_id), row]));
  const questionById = new Map(runtime.cases.map((row) => [row.caseId, row.question]));
  const uniqueAnswers = new Map<string, { caseId: string; answer: string }>();
  for (const row of resultsArtifact.results) {
    const response = row.response as Record<string, unknown> | null;
    if (row.status === "completed" && response && typeof response.answer === "string" && response.answer.trim()) {
      uniqueAnswers.set(`${String(row.caseId)}\0${normalized(response.answer)}`, { caseId: String(row.caseId), answer: response.answer });
    }
  }
  const judge = new QvacEvaluationJudge();
  const judgments: Array<{ caseId: string; answer: string; correct: boolean; completeness: number; rawOutput: string; latencyMs: number; reused?: boolean }> = [];
  const judgeFailures = [];
  let judgmentCacheSha256: string | null = null;
  const cached = new Map<string, typeof judgments[number]>();
  if (args.judgmentsFrom) {
    const cacheBytes = await readFile(path.resolve(args.judgmentsFrom));
    const cacheArtifact = JSON.parse(cacheBytes.toString("utf8")) as { judge?: { model?: unknown }; judgments?: Array<Record<string, unknown>> };
    if (cacheArtifact.judge?.model !== "sourcetruce-extractor" || !Array.isArray(cacheArtifact.judgments)) throw new TypeError("Prior causal judgment cache is incompatible");
    for (const row of cacheArtifact.judgments) {
      if (typeof row.caseId !== "string" || typeof row.answer !== "string" || typeof row.correct !== "boolean" || typeof row.completeness !== "number" || typeof row.rawOutput !== "string" || typeof row.latencyMs !== "number") throw new TypeError("Prior causal judgment cache contains a malformed judgment");
      cached.set(`${row.caseId}\0${normalized(row.answer)}`, { caseId: row.caseId, answer: row.answer, correct: row.correct, completeness: row.completeness, rawOutput: row.rawOutput, latencyMs: row.latencyMs, reused: true });
    }
    judgmentCacheSha256 = digest(cacheBytes);
  }
  for (const answer of uniqueAnswers.values()) {
    const cachedJudgment = cached.get(`${answer.caseId}\0${normalized(answer.answer)}`);
    if (cachedJudgment) {
      judgments.push(cachedJudgment);
      continue;
    }
    const label = labelById.get(answer.caseId)!;
    try {
      const result = await judge.evaluate({
        questionId: answer.caseId,
        question: questionById.get(answer.caseId)!,
        goldAnswer: String(label.gold_answer),
        answerFacts: label.answer_facts as string[],
        candidateAnswer: answer.answer,
      });
      judgments.push({ caseId: answer.caseId, answer: answer.answer, correct: result.decision.correct, completeness: result.decision.completeness, rawOutput: result.rawOutput, latencyMs: result.latencyMs });
    } catch (error) {
      judgeFailures.push({ caseId: answer.caseId, answer: answer.answer, error: error instanceof Error ? error.message : String(error), rawOutput: error instanceof EvaluationJudgeMalformedOutputError ? error.rawOutput : null });
    }
  }
  const retiredValues = new Map<string, string[]>();
  for (const row of runtime.cases) retiredValues.set(row.caseId, row.graph.supersededDocumentIds.map((id) => valuesByCaseSource.get(`${row.caseId}\0${id}`)).filter((value): value is string => Boolean(value)));
  const rows = resultsArtifact.results.map((row) => ({
    caseId: String(row.caseId), armId: String(row.armId), status: row.status as "completed" | "rejected" | "failed", latencyMs: Number(row.latencyMs),
    contextDocumentCount: Number(row.contextDocumentCount), contextTokenBudget: Number(row.contextTokenBudget), hydraQueryCount: Number(row.hydraQueryCount),
    modelInputTokens: typeof (row.modelUsage as Record<string, unknown> | null)?.inputTokens === "number" ? Number((row.modelUsage as Record<string, unknown>).inputTokens) : null,
    response: row.response as null | { answer: string; verdict: "SUPPORTED" | "DISPUTED" | "UNKNOWN" | "NOT_FOUND"; evidenceDocumentIds: string[] },
  }));
  const report = scoreCausalResults({ rows, labels: scoreLabels, judgments, retiredValues });
  const artifact = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), runtimeResultsSha256: digest(resultsBytes), labelsSha256: digest(labelsBytes),
    labelsOpenedAfterRuntime: true, scope: "19 promoted ERB conflict cases; labeled development causal evaluation, not unseen generalization evidence",
    judge: { model: "sourcetruce-extractor", uniqueAnswers: uniqueAnswers.size, scored: judgments.length, reused: judgments.filter((row) => row.reused).length, fresh: judgments.filter((row) => !row.reused).length, failures: judgeFailures.length, judgmentCacheSha256 },
    report, judgments, judgeFailures,
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, uniqueAnswers: uniqueAnswers.size, scored: judgments.length, judgeFailures: judgeFailures.length, wordBudgetParity: report.parity.wordBudgetPassed, modelInputTokenParity: report.parity.modelInputTokenPassed }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
