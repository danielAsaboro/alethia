interface CausalScoreRow {
  caseId: string;
  armId: string;
  status: "completed" | "rejected" | "failed";
  latencyMs: number;
  contextDocumentCount: number;
  contextTokenBudget: number;
  hydraQueryCount: number;
  modelInputTokens: number | null;
  response: null | {
    answer: string;
    verdict: "SUPPORTED" | "DISPUTED" | "UNKNOWN" | "NOT_FOUND";
    evidenceDocumentIds: string[];
  };
}

interface CausalLabel { caseId: string; expectedDocumentIds: string[] }
interface CausalJudgment { caseId: string; answer: string; correct: boolean; completeness: number }

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function scoreCausalResults(input: {
  rows: CausalScoreRow[];
  labels: CausalLabel[];
  judgments: CausalJudgment[];
  retiredValues: Map<string, string[]>;
}) {
  const labels = new Map(input.labels.map((row) => [row.caseId, row]));
  const judgments = new Map(input.judgments.map((row) => [`${row.caseId}\0${normalized(row.answer)}`, row]));
  const armIds = [...new Set(input.rows.map((row) => row.armId))];
  const arms: Record<string, Record<string, number | null>> = {};
  for (const armId of armIds) {
    const rows = input.rows.filter((row) => row.armId === armId);
    let correct = 0, completeness = 0, verdictCorrect = 0, actualEvidence = 0, expectedEvidence = 0;
    let trueEvidence = 0, invalidEvidence = 0, unsupported = 0, abstentions = 0, retired = 0;
    for (const row of rows) {
      const label = labels.get(row.caseId);
      if (!label) throw new TypeError(`Missing causal label for ${row.caseId}`);
      const expected = new Set(label.expectedDocumentIds);
      expectedEvidence += expected.size;
      if (!row.response) continue;
      const actual = new Set(row.response.evidenceDocumentIds);
      actualEvidence += actual.size;
      let rowTrueEvidence = 0;
      for (const id of actual) {
        if (expected.has(id)) rowTrueEvidence += 1;
        else invalidEvidence += 1;
      }
      trueEvidence += rowTrueEvidence;
      if (row.response.answer && rowTrueEvidence === 0) unsupported += 1;
      if (row.response.verdict === "SUPPORTED") verdictCorrect += 1;
      else abstentions += 1;
      const judgment = judgments.get(`${row.caseId}\0${normalized(row.response.answer)}`);
      if (judgment) {
        if (judgment.correct) correct += 1;
        completeness += judgment.completeness;
      }
      if (judgment?.correct) {
        // On this answerable conflict lane, a correct judged answer is the current value.
      }
      const answer = normalized(row.response.answer);
      if (answer && (input.retiredValues.get(row.caseId) ?? []).some((value) => normalized(value) === answer)) retired += 1;
    }
    const evidencePrecision = ratio(trueEvidence, actualEvidence);
    const evidenceRecall = ratio(trueEvidence, expectedEvidence);
    arms[armId] = {
      attempts: rows.length,
      completed: rows.filter((row) => row.status === "completed").length,
      rejected: rows.filter((row) => row.status === "rejected").length,
      failed: rows.filter((row) => row.status === "failed").length,
      answerCorrectness: ratio(correct, rows.length),
      answerCompleteness: ratio(completeness, rows.length),
      verdictAccuracy: ratio(verdictCorrect, rows.length),
      evidencePrecision,
      evidenceRecall,
      evidenceF1: evidencePrecision === null || evidenceRecall === null || evidencePrecision + evidenceRecall === 0 ? 0 : (2 * evidencePrecision * evidenceRecall) / (evidencePrecision + evidenceRecall),
      invalidExtraEvidence: invalidEvidence,
      invalidExtraEvidenceRate: ratio(invalidEvidence, actualEvidence),
      unsupportedAnswerRate: ratio(unsupported, rows.length),
      correctAbstentions: 0,
      incorrectAbstentions: abstentions,
      currentValueSurfaced: correct,
      retiredValuePresentedAsCurrent: retired,
      p50LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5),
      p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
      hydraQueryCount: rows.reduce((sum, row) => sum + row.hydraQueryCount, 0),
    };
  }
  const contextDocumentCounts = [...new Set(input.rows.map((row) => row.contextDocumentCount))].sort((a, b) => a - b);
  const contextTokenBudgets = [...new Set(input.rows.map((row) => row.contextTokenBudget))].sort((a, b) => a - b);
  const caseIds = [...new Set(input.rows.map((row) => row.caseId))];
  const wordBudgetPassed = caseIds.every((caseId) => {
    const rows = input.rows.filter((row) => row.caseId === caseId);
    return new Set(rows.map((row) => row.contextDocumentCount)).size === 1 && new Set(rows.map((row) => row.contextTokenBudget)).size === 1;
  });
  const modelInputTokenCounts = [...new Set(input.rows.map((row) => row.modelInputTokens).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const modelInputTokenMismatchedCaseIds: string[] = [];
  const modelInputTokenUnverifiableCaseIds: string[] = [];
  let modelInputTokenMatchedCases = 0;
  for (const caseId of caseIds) {
    const values = input.rows.filter((row) => row.caseId === caseId).map((row) => row.modelInputTokens);
    if (values.some((value) => value === null)) modelInputTokenUnverifiableCaseIds.push(caseId);
    else if (new Set(values).size === 1) modelInputTokenMatchedCases += 1;
    else modelInputTokenMismatchedCaseIds.push(caseId);
  }
  const modelInputTokenComparableCases = modelInputTokenMatchedCases + modelInputTokenMismatchedCaseIds.length;
  const modelInputTokenPassedForComparableCases = modelInputTokenComparableCases > 0 && modelInputTokenMismatchedCaseIds.length === 0;
  const modelInputTokenPassed = modelInputTokenPassedForComparableCases && modelInputTokenUnverifiableCaseIds.length === 0;
  return {
    arms,
    parity: {
      contextDocumentCounts,
      contextTokenBudgets,
      wordBudgetPassed,
      modelInputTokenCounts,
      modelInputTokenComparableCases,
      modelInputTokenMatchedCases,
      modelInputTokenMismatchedCaseIds,
      modelInputTokenUnverifiableCaseIds,
      modelInputTokenPassedForComparableCases,
      modelInputTokenPassed,
    },
  };
}
