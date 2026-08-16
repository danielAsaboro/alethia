import { describe, expect, it } from "vitest";

import type { CaseWorkspace } from "@/application/run-case";
import type { JudgeCaseKind } from "@/cases/case-registry";
import type { EvaluationLabelV2 } from "./contract";
import {
  freezeFirstPrizeResults,
  scoreFirstPrizeResultsV2,
  type FrozenCaseResult,
} from "./run-first-prize-evaluation";

function frozenResult(
  caseId: string,
  kind: JudgeCaseKind,
  verdict: CaseWorkspace["verdict"],
  answer: string,
  evidence: CaseWorkspace["evidence"] = [{ source: "slack · losing-doc", quote: "30% was proposed", value: "30%" }],
): FrozenCaseResult {
  return {
    caseId,
    status: "completed",
    latencyMs: 4,
    workspace: {
      case: { id: caseId, kind, title: "x", question: "q", summary: "s", dataset: "ERB", version: "v" },
      verdict,
      answer,
      evidence,
      decision: { status: kind === "conflict" ? "resolved" : "supported", reason: "policy" },
      coverage: { sufficient: true, detail: "complete" },
      counterfactual: "later claim",
      traversal: "graph",
      ablation: { label: "none", result: "disputed" },
      graphProof: {
        operation: "algo.SPpaths",
        consistency: "strong",
        queryId: "query-1",
        readEpoch: 1,
        bookmark: "sgk:test:1",
        latencyMs: 1,
        roundTrips: 1,
        pathLength: 2,
        path: "entity → claim → source",
        relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
      },
    },
  };
}

function label(overrides: Partial<EvaluationLabelV2> = {}): EvaluationLabelV2 {
  return {
    caseId: "streamly-credit-conflict",
    expectedVerdict: "SUPPORTED",
    expectedFacts: [{ kind: "percentage", value: 30 }],
    expectedEvidenceDocumentIds: ["winning-doc"],
    expectedRelationships: ["ASSERTS", "SUPPORTED_BY"],
    forbiddenRelationships: ["DECIDED_BY"],
    requiredCoverageState: "complete",
    expectedConflictState: "resolved",
    requiredGraphProof: {
      requiredRelationships: ["ASSERTS", "SUPPORTED_BY"],
      minimumPathLength: 2,
      maximumPathLength: 2,
      requireLiveQueryId: true,
    },
    expectedIdentityState: "not_applicable",
    expectedAlignmentState: "not_applicable",
    ...overrides,
  };
}

describe("generic judge evaluation separation", () => {
  it("does not score a losing-evidence substring as the structured answer", () => {
    const result = frozenResult(
      "streamly-credit-conflict",
      "conflict",
      "SUPPORTED",
      "20%",
      [
        { source: "slack · losing-doc", quote: "The rejected proposal was 30%", value: "30%" },
        { source: "drive · winning-doc", quote: "The applied value is 20%", value: "20%" },
      ],
    );

    const report = scoreFirstPrizeResultsV2([result], [label()]);

    expect(report.answerCorrectness).toBe(0);
    expect(report.evidence.recall).toBe(1);
  });

  it("freezes and digests runtime results before labels are applied", () => {
    const result = frozenResult("streamly-credit-conflict", "conflict", "SUPPORTED", "30%", [
      { source: "drive · winning-doc", quote: "The applied value is 30%", value: "30%" },
    ]);
    const frozen = freezeFirstPrizeResults([result]);

    expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(frozen.serialized)).toEqual([result]);
    expect(frozen.serialized).not.toMatch(/expectedVerdict|expectedFacts|expectedEvidence/);
    expect(scoreFirstPrizeResultsV2(JSON.parse(frozen.serialized), [label()]).answerCorrectness).toBe(1);
  });

  it("keeps failed judge cases in attempted denominators", () => {
    const report = scoreFirstPrizeResultsV2(
      [{ caseId: "streamly-credit-conflict", latencyMs: 9, status: "failed", error: "Hydra unavailable" }],
      [label()],
    );

    expect(report.counts).toEqual({ attempted: 1, completed: 0, rejected: 0, failed: 1, unscored: 0 });
    expect(report.verdictAccuracy).toBe(0);
  });

  it("extracts the first grounded duration from a resolved conflict answer", () => {
    const result = frozenResult(
      "handshake-ttl-conflict",
      "conflict",
      "SUPPORTED",
      "Handshake tokens now default to TTL 120 seconds (was 180s) due to replay-risk hardening.",
    );

    const report = scoreFirstPrizeResultsV2([result], [label({
      caseId: "handshake-ttl-conflict",
      expectedFacts: [{ kind: "duration", value: 120, unit: "seconds" }],
    })]);

    expect(report.answerCorrectness).toBe(1);
  });
});
