import { createHash } from "node:crypto";

import { listJudgeCases } from "@/cases/case-registry";
import { runJudgeCase, type CaseRepository, type CaseWorkspace } from "@/application/run-case";
import type {
  CompletedEvaluationAttemptV2,
  EvaluationAttemptV2,
  EvaluationFact,
  EvaluationLabelV2,
} from "./contract";
import { scoreAttemptsV2 } from "./metrics";

export interface FrozenCaseResult {
  caseId: string;
  latencyMs: number;
  status: "completed" | "failed";
  workspace?: CaseWorkspace;
  error?: string;
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

function evidenceDocumentId(item: CaseWorkspace["evidence"][number]): string {
  if (/^source_object_[a-f0-9]+$/i.test(item.quote.trim())) return item.quote.trim();
  const segments = item.source.split("·");
  return (segments.at(-1) ?? item.source).trim();
}

function numericFact(answer: string): EvaluationFact | undefined {
  const percentage = answer.trim().match(/^(-?\d+(?:\.\d+)?)%$/);
  if (percentage) return { kind: "percentage", value: Number(percentage[1]) };

  const duration = answer.match(/(-?\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|hours?|hrs?)\b/i);
  if (duration) {
    const rawUnit = duration[2].toLocaleLowerCase();
    const unit = rawUnit.startsWith("ms") || rawUnit.startsWith("millisecond")
      ? "milliseconds"
      : rawUnit === "s" || rawUnit.startsWith("sec")
        ? "seconds"
        : rawUnit.startsWith("min")
          ? "minutes"
          : "hours";
    return { kind: "duration", value: Number(duration[1]), unit };
  }
  return undefined;
}

function structuredFacts(workspace: CaseWorkspace): EvaluationFact[] {
  if (workspace.verdict === "UNKNOWN" || workspace.verdict === "NOT_FOUND") return [];

  if (workspace.case.kind === "conflict" && workspace.verdict === "DISPUTED") {
    return [{
      kind: "identifier_set",
      values: workspace.evidence
        .map((item) => item.value)
        .filter((value): value is string => typeof value === "string"),
    }];
  }

  if (workspace.case.kind === "multi_hop") {
    const count = workspace.answer.match(/^(\d+)\s+team members:/i);
    return count ? [{ kind: "number", value: Number(count[1]), unit: "team_members" }] : [];
  }

  if (workspace.case.kind === "alignment") {
    const ontologyTerms = workspace.answer.match(/\b[A-Z][A-Z_]{2,}\b/g) ?? [];
    return [{ kind: "identifier_set", values: ontologyTerms }];
  }

  const numeric = numericFact(workspace.answer);
  return [numeric ?? { kind: "text", value: workspace.answer }];
}

export function caseResultToAttempt(result: FrozenCaseResult): EvaluationAttemptV2 {
  if (result.status === "failed" || !result.workspace) {
    return {
      schemaVersion: 2,
      caseId: result.caseId,
      status: "failed",
      latencyMs: result.latencyMs,
      error: result.error ?? "Case failed without an error message",
    };
  }

  const workspace = result.workspace;
  const identityState = workspace.case.kind === "identity"
    ? (workspace.decision.status === "accepted" || workspace.decision.status === "rejected" || workspace.decision.status === "pending"
      ? workspace.decision.status
      : "pending")
    : "not_applicable";
  const alignmentState = workspace.case.kind === "alignment"
    ? (workspace.decision.status === "accepted" || workspace.decision.status === "rejected" || workspace.decision.status === "pending"
      ? workspace.decision.status
      : "pending")
    : "not_applicable";
  const conflictState = workspace.case.kind !== "conflict"
    ? "not_applicable"
    : workspace.decision.status === "resolved"
      ? "resolved"
      : workspace.decision.status === "unresolved"
        ? "unresolved"
        : "detected";

  const attempt: CompletedEvaluationAttemptV2 = {
    schemaVersion: 2,
    caseId: result.caseId,
    status: "completed",
    latencyMs: result.latencyMs,
    verdict: workspace.verdict,
    facts: structuredFacts(workspace),
    evidenceDocumentIds: [...new Set(workspace.evidence.map(evidenceDocumentId))],
    relationships: [...workspace.graphProof.relationshipTypes],
    coverageState: workspace.coverage.sufficient ? "complete" : "partial",
    conflictState,
    identityState,
    alignmentState,
    grounding: { accepted: workspace.evidence.length, rejected: 0 },
    graphProofs: [{
      queryId: workspace.graphProof.queryId,
      live: true,
      relationshipTypes: [...workspace.graphProof.relationshipTypes],
      pathLength: workspace.graphProof.pathLength,
      sourceLabel: workspace.graphProof.nodes[0]?.labels[0],
      targetLabel: workspace.graphProof.nodes.at(-1)?.labels[0],
    }],
  };
  return attempt;
}

export function freezeFirstPrizeResults(results: FrozenCaseResult[]): {
  serialized: string;
  sha256: string;
} {
  const serialized = JSON.stringify(results);
  return {
    serialized,
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

export function scoreFirstPrizeResultsV2(
  results: FrozenCaseResult[],
  labels: EvaluationLabelV2[],
) {
  return scoreAttemptsV2(results.map(caseResultToAttempt), labels);
}
