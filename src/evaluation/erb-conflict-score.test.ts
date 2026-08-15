import { describe, expect, it } from "vitest";

import type { FrozenConflictRuntime } from "./erb-conflict-runtime";
import {
  scoreErbConflictRuntime,
  type ErbConflictLabel,
  type ErbJudgeOutcome,
} from "./erb-conflict-score";

const runtime: FrozenConflictRuntime = {
  schemaVersion: 1,
  manifestDigest: "a".repeat(64),
  runtime: { model: "sourcetruce-extractor", promptVersion: "conflict-observation-v7" },
  summary: { attempted: 3, completed: 2, rejected: 1, failed: 0 },
  cases: [
    {
      questionId: "qst_0411",
      question: "Q1?",
      questionType: "conflicting_info",
      status: "completed",
      verdict: "SUPPORTED",
      answer: "new",
      evidenceDocumentIds: ["d1", "extra"],
      selectedSourceObjectIds: ["s1", "s2"],
      latencyMs: 10,
      failureReason: null,
      extractionFailures: [],
    },
    {
      questionId: "qst_0412",
      question: "Q2?",
      questionType: "conflicting_info",
      status: "rejected",
      verdict: null,
      answer: null,
      evidenceDocumentIds: [],
      selectedSourceObjectIds: ["s3", "s4"],
      latencyMs: 20,
      failureReason: "invalid JSON",
      extractionFailures: [],
    },
    {
      questionId: "qst_0413",
      question: "Q3?",
      questionType: "conflicting_info",
      status: "completed",
      verdict: "DISPUTED",
      answer: "Unresolved conflict: old vs new.",
      evidenceDocumentIds: ["d3"],
      selectedSourceObjectIds: ["s5", "s6"],
      latencyMs: 30,
      failureReason: null,
      extractionFailures: [],
    },
  ],
  digest: "b".repeat(64),
};

const labels: ErbConflictLabel[] = [
  { questionId: "qst_0411", question: "Q1?", expectedDocumentIds: ["d1"], goldAnswer: "new", answerFacts: ["new"] },
  { questionId: "qst_0412", question: "Q2?", expectedDocumentIds: ["d2"], goldAnswer: "96%", answerFacts: ["96%"] },
  { questionId: "qst_0413", question: "Q3?", expectedDocumentIds: ["d3", "d4"], goldAnswer: "new", answerFacts: ["new", "current"] },
];

const judgments: ErbJudgeOutcome[] = [
  {
    questionId: "qst_0411",
    status: "scored",
    rawOutput: "raw-1",
    latencyMs: 5,
    decision: { correct: true, completeness: 1, satisfiedFactIndexes: [0], reason: "complete" },
  },
  {
    questionId: "qst_0413",
    status: "unscored",
    kind: "malformed_output",
    rawOutput: "not json",
    latencyMs: 7,
    error: "invalid judge response",
  },
];

describe("scoreErbConflictRuntime", () => {
  it("keeps every attempted case in honest answer, verdict, and evidence metrics", () => {
    const result = scoreErbConflictRuntime({ runtime, labels, judgments });

    expect(result.aggregate).toEqual({
      attempted: 3,
      answered: 2,
      rejected: 1,
      failed: 0,
      scoredAnswers: 1,
      unscoredAnswers: 1,
      answerCorrectness: 1 / 3,
      answerCompleteness: 1 / 3,
      verdictAccuracy: 1 / 3,
      verdictConfusion: { SUPPORTED: { SUPPORTED: 1, UNKNOWN: 1, DISPUTED: 1 } },
      evidenceRecall: 0.5,
      invalidExtraEvidenceRate: 1 / 3,
      groundingAcceptance: 2 / 3,
      malformedOutputRate: 0.5,
      p50LatencyMs: 20,
      p95LatencyMs: 30,
      judgeP50LatencyMs: 5,
      judgeP95LatencyMs: 7,
    });
    expect(result.cases.find((item) => item.questionId === "qst_0412")).toMatchObject({
      runtimeStatus: "rejected",
      answerCorrect: false,
      answerCompleteness: 0,
      judge: null,
    });
    expect(result.cases.find((item) => item.questionId === "qst_0413")).toMatchObject({
      answerCorrect: false,
      answerCompleteness: 0,
      judge: { status: "unscored", kind: "malformed_output", rawOutput: "not json" },
    });
  });

  it("uses null for empty denominators", () => {
    const empty: FrozenConflictRuntime = {
      schemaVersion: 1,
      manifestDigest: "a".repeat(64),
      runtime: { model: "m", promptVersion: "p" },
      summary: { attempted: 0, completed: 0, rejected: 0, failed: 0 },
      cases: [],
      digest: "b".repeat(64),
    };
    expect(scoreErbConflictRuntime({ runtime: empty, labels: [], judgments: [] }).aggregate).toMatchObject({
      answerCorrectness: null,
      answerCompleteness: null,
      verdictAccuracy: null,
      evidenceRecall: null,
      invalidExtraEvidenceRate: null,
      groundingAcceptance: null,
      malformedOutputRate: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      judgeP50LatencyMs: null,
      judgeP95LatencyMs: null,
    });
  });

  it("rejects missing, duplicate, or question-mismatched labels and judgments", () => {
    expect(() => scoreErbConflictRuntime({ runtime, labels: labels.slice(1), judgments })).toThrow(/label IDs/i);
    expect(() => scoreErbConflictRuntime({ runtime, labels: [...labels, labels[0]!], judgments })).toThrow(/duplicate label/i);
    expect(() => scoreErbConflictRuntime({ runtime, labels: [{ ...labels[0]!, question: "wrong" }, ...labels.slice(1)], judgments })).toThrow(/question mismatch/i);
    expect(() => scoreErbConflictRuntime({ runtime, labels, judgments: [...judgments, judgments[0]!] })).toThrow(/duplicate judge/i);
  });
});
