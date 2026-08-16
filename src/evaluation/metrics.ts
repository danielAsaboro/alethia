import type { Verdict } from "@/domain/ontology";
import type {
  CompletedEvaluationAttemptV2,
  EvaluationAttemptV2,
  EvaluationLabelV2,
} from "./contract";
import { normalizedFactKey } from "./normalize-facts";

export interface EvaluationCase {
  expectedVerdict: Verdict;
  actualVerdict: Verdict;
  expectedEvidenceIds: string[];
  actualEvidenceIds: string[];
  latencyMs: number;
}

export interface EvaluationReport {
  cases: number;
  verdictAccuracy: number;
  evidenceRecall: number | null;
  invalidExtraEvidenceRate: number | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  confusion: Partial<Record<Verdict, Partial<Record<Verdict, number>>>>;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

export function evaluateCases(cases: EvaluationCase[]): EvaluationReport {
  let correct = 0;
  let expectedEvidence = 0;
  let recalledEvidence = 0;
  let actualEvidence = 0;
  let invalidEvidence = 0;
  const confusion: EvaluationReport["confusion"] = {};

  for (const item of cases) {
    if (item.expectedVerdict === item.actualVerdict) correct += 1;
    const row = (confusion[item.expectedVerdict] ??= {});
    row[item.actualVerdict] = (row[item.actualVerdict] ?? 0) + 1;

    const expected = new Set(item.expectedEvidenceIds);
    expectedEvidence += expected.size;
    const actual = new Set(item.actualEvidenceIds);
    actualEvidence += actual.size;
    for (const id of actual) {
      if (expected.has(id)) recalledEvidence += 1;
      else invalidEvidence += 1;
    }
  }

  return {
    cases: cases.length,
    verdictAccuracy: cases.length === 0 ? 0 : correct / cases.length,
    evidenceRecall: ratio(recalledEvidence, expectedEvidence),
    invalidExtraEvidenceRate: ratio(invalidEvidence, actualEvidence),
    p50LatencyMs: percentile(cases.map((item) => item.latencyMs), 0.5),
    p95LatencyMs: percentile(cases.map((item) => item.latencyMs), 0.95),
    confusion,
  };
}

export function evaluatePairs(gold: Set<string>, predicted: Set<string>) {
  let truePositive = 0;
  for (const pair of predicted) {
    if (gold.has(pair)) truePositive += 1;
  }
  const falsePositive = predicted.size - truePositive;
  const falseNegative = gold.size - truePositive;
  const precision = ratio(truePositive, truePositive + falsePositive) ?? 0;
  const recall = ratio(truePositive, truePositive + falseNegative) ?? 0;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1 };
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function setCounts(expectedValues: string[], actualValues: string[]) {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  let truePositive = 0;
  for (const value of actual) if (expected.has(value)) truePositive += 1;
  return {
    truePositive,
    falsePositive: actual.size - truePositive,
    falseNegative: expected.size - truePositive,
  };
}

function graphProofMatches(attempt: CompletedEvaluationAttemptV2, label: EvaluationLabelV2): boolean {
  const required = label.requiredGraphProof;
  if (
    required.requiredRelationships.length === 0 &&
    !required.requireLiveQueryId &&
    required.minimumPathLength === undefined &&
    required.maximumPathLength === undefined &&
    required.sourceLabel === undefined &&
    required.targetLabel === undefined
  ) return true;

  return attempt.graphProofs.some((proof) => {
    if (!proof.live) return false;
    if (required.requireLiveQueryId && !proof.queryId) return false;
    if (required.sourceLabel && proof.sourceLabel !== required.sourceLabel) return false;
    if (required.targetLabel && proof.targetLabel !== required.targetLabel) return false;
    if (required.minimumPathLength !== undefined && proof.pathLength < required.minimumPathLength) return false;
    if (required.maximumPathLength !== undefined && proof.pathLength > required.maximumPathLength) return false;
    return required.requiredRelationships.every((relationship) => proof.relationshipTypes.includes(relationship));
  });
}

function isAbstention(verdict: Verdict | undefined): boolean {
  return verdict === "UNKNOWN" || verdict === "DISPUTED";
}

export interface EvaluationReportV2 {
  schemaVersion: 2;
  counts: { attempted: number; completed: number; rejected: number; failed: number; unscored: number };
  answerCorrectness: number;
  answerCompleteness: number;
  verdictAccuracy: number;
  verdictConfusion: Partial<Record<Verdict, Partial<Record<Verdict | "NO_RESULT", number>>>>;
  evidence: { precision: number | null; recall: number | null; f1: number | null; invalidExtraEvidenceRate: number | null };
  grounding: { accepted: number; rejected: number; acceptanceRate: number | null; rejectionRate: number | null };
  relationshipAccuracy: number | null;
  coverageAccuracy: number | null;
  graphProofAccuracy: number | null;
  conflictDetectionAccuracy: number | null;
  conflictResolutionAccuracy: number | null;
  identityDecisionAccuracy: number | null;
  alignmentDecisionAccuracy: number | null;
  abstention: { precision: number | null; recall: number | null };
  latency: { p50Ms: number; p95Ms: number };
}

export function scoreAttemptsV2(
  attempts: EvaluationAttemptV2[],
  labels: EvaluationLabelV2[],
): EvaluationReportV2 {
  const labelByCase = new Map(labels.map((label) => [label.caseId, label]));
  const attemptByCase = new Map(attempts.map((attempt) => [attempt.caseId, attempt]));
  const scored = labels.map((label) => ({ label, attempt: attemptByCase.get(label.caseId) }));
  const completed = attempts.filter((attempt): attempt is CompletedEvaluationAttemptV2 => attempt.status === "completed");

  let exactAnswers = 0;
  let completeness = 0;
  let correctVerdicts = 0;
  let expectedEvidence = 0;
  let actualEvidence = 0;
  let trueEvidence = 0;
  let invalidEvidence = 0;
  let correctRelationships = 0;
  let correctCoverage = 0;
  let correctGraphProof = 0;
  let conflictApplicable = 0;
  let correctConflictDetection = 0;
  let conflictResolutionApplicable = 0;
  let correctConflictResolution = 0;
  let identityApplicable = 0;
  let correctIdentity = 0;
  let alignmentApplicable = 0;
  let correctAlignment = 0;
  let expectedAbstentions = 0;
  let actualAbstentions = 0;
  let trueAbstentions = 0;
  const verdictConfusion: EvaluationReportV2["verdictConfusion"] = {};

  for (const { label, attempt } of scored) {
    const result = attempt?.status === "completed" ? attempt : undefined;
    const expectedFacts = label.expectedFacts.map(normalizedFactKey);
    const actualFacts = result?.facts.map(normalizedFactKey) ?? [];
    const factCounts = setCounts(expectedFacts, actualFacts);
    if (result && factCounts.falsePositive === 0 && factCounts.falseNegative === 0) exactAnswers += 1;
    completeness += !result
      ? 0
      : expectedFacts.length === 0
        ? (actualFacts.length === 0 ? 1 : 0)
        : factCounts.truePositive / new Set(expectedFacts).size;

    if (result?.verdict === label.expectedVerdict) correctVerdicts += 1;
    const row = (verdictConfusion[label.expectedVerdict] ??= {});
    const actualVerdict = result?.verdict ?? "NO_RESULT";
    row[actualVerdict] = (row[actualVerdict] ?? 0) + 1;

    const evidenceCounts = setCounts(label.expectedEvidenceDocumentIds, result?.evidenceDocumentIds ?? []);
    expectedEvidence += new Set(label.expectedEvidenceDocumentIds).size;
    actualEvidence += new Set(result?.evidenceDocumentIds ?? []).size;
    trueEvidence += evidenceCounts.truePositive;
    invalidEvidence += evidenceCounts.falsePositive;

    const hasExpectedRelationships = label.expectedRelationships.every((item) => result?.relationships.includes(item));
    const hasForbiddenRelationships = label.forbiddenRelationships.some((item) => result?.relationships.includes(item));
    if (result && hasExpectedRelationships && !hasForbiddenRelationships) correctRelationships += 1;
    if (result?.coverageState === label.requiredCoverageState) correctCoverage += 1;
    if (result && graphProofMatches(result, label)) correctGraphProof += 1;

    if (label.expectedConflictState !== "not_applicable") {
      conflictApplicable += 1;
      const expectedDetected = label.expectedConflictState !== "none";
      const actualDetected = result ? !["none", "not_applicable"].includes(result.conflictState) : false;
      if (expectedDetected === actualDetected) correctConflictDetection += 1;
      if (["resolved", "unresolved"].includes(label.expectedConflictState)) {
        conflictResolutionApplicable += 1;
        if (result?.conflictState === label.expectedConflictState) correctConflictResolution += 1;
      }
    }
    if (label.expectedIdentityState !== "not_applicable") {
      identityApplicable += 1;
      if (result?.identityState === label.expectedIdentityState) correctIdentity += 1;
    }
    if (label.expectedAlignmentState !== "not_applicable") {
      alignmentApplicable += 1;
      if (result?.alignmentState === label.expectedAlignmentState) correctAlignment += 1;
    }

    const expectedAbstain = isAbstention(label.expectedVerdict);
    const actualAbstain = isAbstention(result?.verdict);
    if (expectedAbstain) expectedAbstentions += 1;
    if (actualAbstain) actualAbstentions += 1;
    if (expectedAbstain && actualAbstain) trueAbstentions += 1;
  }

  const groundingAccepted = completed.reduce((sum, attempt) => sum + attempt.grounding.accepted, 0);
  const groundingRejected = completed.reduce((sum, attempt) => sum + attempt.grounding.rejected, 0);
  const groundingTotal = groundingAccepted + groundingRejected;
  const scoredCount = labels.length;
  const evidencePrecision = ratio(trueEvidence, actualEvidence);
  const evidenceRecall = ratio(trueEvidence, expectedEvidence);

  return {
    schemaVersion: 2,
    counts: {
      attempted: attempts.length,
      completed: completed.length,
      rejected: attempts.filter((attempt) => attempt.status === "rejected").length,
      failed: attempts.filter((attempt) => attempt.status === "failed").length,
      unscored: attempts.filter((attempt) => !labelByCase.has(attempt.caseId)).length,
    },
    answerCorrectness: scoredCount === 0 ? 0 : exactAnswers / scoredCount,
    answerCompleteness: scoredCount === 0 ? 0 : completeness / scoredCount,
    verdictAccuracy: scoredCount === 0 ? 0 : correctVerdicts / scoredCount,
    verdictConfusion,
    evidence: {
      precision: evidencePrecision,
      recall: evidenceRecall,
      f1: f1(evidencePrecision, evidenceRecall),
      invalidExtraEvidenceRate: ratio(invalidEvidence, actualEvidence),
    },
    grounding: {
      accepted: groundingAccepted,
      rejected: groundingRejected,
      acceptanceRate: ratio(groundingAccepted, groundingTotal),
      rejectionRate: ratio(groundingRejected, groundingTotal),
    },
    relationshipAccuracy: ratio(correctRelationships, scoredCount),
    coverageAccuracy: ratio(correctCoverage, scoredCount),
    graphProofAccuracy: ratio(correctGraphProof, scoredCount),
    conflictDetectionAccuracy: ratio(correctConflictDetection, conflictApplicable),
    conflictResolutionAccuracy: ratio(correctConflictResolution, conflictResolutionApplicable),
    identityDecisionAccuracy: ratio(correctIdentity, identityApplicable),
    alignmentDecisionAccuracy: ratio(correctAlignment, alignmentApplicable),
    abstention: {
      precision: ratio(trueAbstentions, actualAbstentions),
      recall: ratio(trueAbstentions, expectedAbstentions),
    },
    latency: {
      p50Ms: percentile(attempts.map((attempt) => attempt.latencyMs), 0.5),
      p95Ms: percentile(attempts.map((attempt) => attempt.latencyMs), 0.95),
    },
  };
}
