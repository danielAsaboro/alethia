import type { Verdict } from "@/domain/ontology";
import { evaluateCases } from "./metrics";
import type { FrozenConflictRuntime } from "./erb-conflict-runtime";
import type { EvaluationJudgeDecision } from "@/qvac/evaluation-judge";

export interface ErbConflictLabel {
  questionId: string;
  question: string;
  expectedDocumentIds: string[];
  goldAnswer: string;
  answerFacts: string[];
}

export type ErbJudgeOutcome =
  | {
      questionId: string;
      status: "scored";
      decision: EvaluationJudgeDecision;
      rawOutput: string;
      latencyMs: number;
    }
  | {
      questionId: string;
      status: "unscored";
      kind: "malformed_output" | "judge_error";
      rawOutput: string | null;
      latencyMs: number;
      error: string;
    };

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]!;
}

function uniqueById<T extends { questionId: string }>(
  values: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.questionId)) throw new TypeError(`Duplicate ${label} ID: ${value.questionId}`);
    result.set(value.questionId, value);
  }
  return result;
}

export function scoreErbConflictRuntime(input: {
  runtime: FrozenConflictRuntime;
  labels: ErbConflictLabel[];
  judgments: ErbJudgeOutcome[];
}) {
  const labels = uniqueById(input.labels, "label");
  const judgments = uniqueById(input.judgments, "judge");
  const runtimeIds = new Set(input.runtime.cases.map((item) => item.questionId));
  if (
    labels.size !== runtimeIds.size ||
    [...runtimeIds].some((id) => !labels.has(id)) ||
    [...labels].some(([id]) => !runtimeIds.has(id))
  ) {
    throw new TypeError("Runtime and label IDs do not match exactly");
  }
  if ([...judgments].some(([id]) => !runtimeIds.has(id))) {
    throw new TypeError("Judge IDs are not a subset of runtime IDs");
  }

  const evidenceCases = input.runtime.cases.map((runtimeCase) => {
    const label = labels.get(runtimeCase.questionId)!;
    if (label.question !== runtimeCase.question) {
      throw new TypeError(`Runtime/label question mismatch: ${runtimeCase.questionId}`);
    }
    return {
      expectedVerdict: "SUPPORTED" as Verdict,
      actualVerdict: (runtimeCase.verdict ?? "UNKNOWN") as Verdict,
      expectedEvidenceIds: label.expectedDocumentIds,
      actualEvidenceIds: runtimeCase.evidenceDocumentIds,
      latencyMs: runtimeCase.latencyMs,
    };
  });
  const base = evaluateCases(evidenceCases);
  const cases = input.runtime.cases.map((runtimeCase) => {
    const label = labels.get(runtimeCase.questionId)!;
    const judge = judgments.get(runtimeCase.questionId) ?? null;
    const scored = judge?.status === "scored" ? judge.decision : null;
    return {
      questionId: runtimeCase.questionId,
      question: runtimeCase.question,
      runtimeStatus: runtimeCase.status,
      expectedVerdict: "SUPPORTED" as const,
      actualVerdict: runtimeCase.verdict ?? "UNKNOWN",
      candidateAnswer: runtimeCase.answer,
      goldAnswer: label.goldAnswer,
      answerFacts: label.answerFacts,
      expectedDocumentIds: label.expectedDocumentIds,
      actualDocumentIds: runtimeCase.evidenceDocumentIds,
      answerCorrect: scored?.correct ?? false,
      answerCompleteness: scored?.completeness ?? 0,
      judge,
      runtimeLatencyMs: runtimeCase.latencyMs,
      failureReason: runtimeCase.failureReason,
    };
  });
  const attempted = cases.length;
  const answered = cases.filter((item) => item.runtimeStatus === "completed").length;
  const judgeLatencies = input.judgments.map((item) => item.latencyMs);
  return {
    aggregate: {
      attempted,
      answered,
      rejected: cases.filter((item) => item.runtimeStatus === "rejected").length,
      failed: cases.filter((item) => item.runtimeStatus === "failed").length,
      scoredAnswers: cases.filter((item) => item.judge?.status === "scored").length,
      unscoredAnswers: cases.filter(
        (item) => item.runtimeStatus === "completed" && item.judge?.status !== "scored",
      ).length,
      answerCorrectness: ratio(cases.filter((item) => item.answerCorrect).length, attempted),
      answerCompleteness: ratio(
        cases.reduce((total, item) => total + item.answerCompleteness, 0),
        attempted,
      ),
      verdictAccuracy: attempted === 0 ? null : base.verdictAccuracy,
      verdictConfusion: base.confusion,
      evidenceRecall: base.evidenceRecall,
      invalidExtraEvidenceRate: base.invalidExtraEvidenceRate,
      groundingAcceptance: ratio(answered, attempted),
      malformedOutputRate: ratio(
        input.judgments.filter(
          (item) => item.status === "unscored" && item.kind === "malformed_output",
        ).length,
        answered,
      ),
      p50LatencyMs: percentile(cases.map((item) => item.runtimeLatencyMs), 0.5),
      p95LatencyMs: percentile(cases.map((item) => item.runtimeLatencyMs), 0.95),
      judgeP50LatencyMs: percentile(judgeLatencies, 0.5),
      judgeP95LatencyMs: percentile(judgeLatencies, 0.95),
    },
    cases,
  };
}
