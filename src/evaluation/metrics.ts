import type { Verdict } from "@/domain/ontology";

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
