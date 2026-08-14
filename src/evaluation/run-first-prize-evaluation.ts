import { listJudgeCases } from "@/cases/case-registry";
import { runJudgeCase, type CaseRepository, type CaseWorkspace } from "@/application/run-case";

export interface FrozenCaseResult {
  caseId: string;
  latencyMs: number;
  status: "completed" | "failed";
  workspace?: CaseWorkspace;
  error?: string;
}

export interface IdentityLaneStats {
  records: number;
  acceptedExactLinks: number;
  sameNameCandidates: number;
  hardNegativePairs: number;
  sourceTruceFalseMerges: number;
  graphNodes: number;
  graphEdges: number;
}

export async function runFirstPrizeCases(repository: CaseRepository): Promise<FrozenCaseResult[]> {
  const results: FrozenCaseResult[] = [];
  for (const item of listJudgeCases()) {
    const started = performance.now();
    try {
      const workspace = await runJudgeCase(item.id, repository);
      results.push({
        caseId: item.id,
        latencyMs: Number((performance.now() - started).toFixed(3)),
        status: "completed",
        workspace,
      });
    } catch (error) {
      results.push({
        caseId: item.id,
        latencyMs: Number((performance.now() - started).toFixed(3)),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

const scoringLabels = {
  "streamly-credit-conflict": { verdict: "SUPPORTED", answerIncludes: "30%" },
  "handshake-ttl-conflict": { verdict: "DISPUTED", answerIncludes: "120" },
  "owner-is-not-owner": { verdict: "SUPPORTED", answerIncludes: "distinct" },
  "david-taylor-collision": { verdict: "SUPPORTED", answerIncludes: "two people" },
  "favorite-lunch-boundary": { verdict: "UNKNOWN", answerIncludes: "Not enough evidence" },
} as const;

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export function scoreFirstPrizeResults(results: FrozenCaseResult[], identity: IdentityLaneStats) {
  const completed = results.filter((result) => result.status === "completed" && result.workspace);
  const scored = completed.map((result) => {
    const label = scoringLabels[result.caseId as keyof typeof scoringLabels];
    const correct = Boolean(label && result.workspace?.verdict === label.verdict && result.workspace.answer.includes(label.answerIncludes));
    return { caseId: result.caseId, correct, verdict: result.workspace!.verdict, evidenceItems: result.workspace!.evidence.length };
  });
  const alignment = completed.find((result) => result.caseId === "owner-is-not-owner")?.workspace;
  const conflict = completed.find((result) => result.caseId === "streamly-credit-conflict")?.workspace;
  const boundary = completed.find((result) => result.caseId === "favorite-lunch-boundary")?.workspace;
  return {
    attempted: results.length,
    completed: completed.length,
    failed: results.length - completed.length,
    caseAccuracy: scored.length === 0 ? 0 : scored.filter((item) => item.correct).length / scored.length,
    p50LatencyMs: percentile(completed.map((item) => item.latencyMs), 0.5),
    p95LatencyMs: percentile(completed.map((item) => item.latencyMs), 0.95),
    cases: scored,
    lanes: {
      conflict: {
        completed: Boolean(conflict),
        competingEvidenceItems: conflict?.evidence.length ?? 0,
        resolvedByPolicy: conflict?.decision.status === "resolved",
        noPolicyAblation: conflict?.ablation.result ?? "unavailable",
      },
      alignment: {
        completed: Boolean(alignment),
        contextualMappingsCompared: alignment?.evidence.length ?? 0,
        naiveFieldNameFailure: alignment?.ablation.result ?? "unavailable",
      },
      identity: {
        ...identity,
        naiveFuzzyFalseMerges: identity.hardNegativePairs,
      },
      coverage: {
        completed: Boolean(boundary),
        verdict: boundary?.verdict ?? "unavailable",
        noCoverageGateFailure: boundary?.ablation.result ?? "unavailable",
      },
    },
  };
}
