export interface CachedCausalJudgment {
  caseId: string;
  answer: string;
  correct: boolean;
  completeness: number;
  rawOutput: string;
  latencyMs: number;
  reused?: boolean;
}

export interface CachedCausalJudgeFailure {
  caseId: string;
  answer: string;
  error: string;
  rawOutput: string | null;
  reused?: boolean;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function indexCausalJudgmentCache(input: {
  judgments: CachedCausalJudgment[];
  judgeFailures: CachedCausalJudgeFailure[];
}) {
  return {
    judgments: new Map(input.judgments.map((row) => [`${row.caseId}\0${normalized(row.answer)}`, { ...row, reused: true }])),
    failures: new Map(input.judgeFailures.map((row) => [`${row.caseId}\0${normalized(row.answer)}`, { ...row, reused: true }])),
  };
}
