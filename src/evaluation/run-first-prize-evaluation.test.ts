import { describe, expect, it } from "vitest";
import type { CaseWorkspace } from "@/application/run-case";
import type { JudgeCaseKind } from "@/cases/case-registry";
import { scoreFirstPrizeResults, type FrozenCaseResult } from "./run-first-prize-evaluation";

function frozenResult(
  caseId: string,
  kind: JudgeCaseKind,
  verdict: CaseWorkspace["verdict"],
  answer: string,
): FrozenCaseResult {
  return {
    caseId,
    status: "completed",
    latencyMs: 4,
    workspace: {
      case: { id: caseId, kind, title: "x", question: "q", summary: "s", dataset: "ERB", version: "v" },
      verdict,
      answer,
      evidence: [{ source: "s", quote: "q" }, { source: "t", quote: "r" }],
      decision: { status: "resolved", reason: "policy" },
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

describe("first-prize evaluation separation", () => {
  it("scores only after receiving frozen runtime workspaces", () => {
    const result = frozenResult("streamly-credit-conflict", "conflict", "SUPPORTED", "30%");
    const report = scoreFirstPrizeResults([result], { records: 698, acceptedExactLinks: 18, sameNameCandidates: 1645, hardNegativePairs: 1627, sourceTruceFalseMerges: 0, graphNodes: 12378, graphEdges: 22906 });
    expect(report.caseAccuracy).toBe(1);
    expect(report.lanes.identity.naiveFuzzyFalseMerges).toBe(1627);
    expect(JSON.stringify(result)).not.toMatch(/gold_answer|answer_facts|expected_doc_ids/);
  });

  it("scores the simple, multi-hop, and proven-absence lanes", () => {
    const results = [
      frozenResult("charlie-davis-role", "simple_lookup", "SUPPORTED", "Software Engineer"),
      frozenResult("actiongenie-team", "multi_hop", "SUPPORTED", "66 team members: ..."),
      frozenResult("charlie-davis-lagos", "knowledge_boundary", "NOT_FOUND", "No Lagos location was found."),
    ];
    const report = scoreFirstPrizeResults(results, {
      records: 0,
      acceptedExactLinks: 0,
      sameNameCandidates: 0,
      hardNegativePairs: 0,
      sourceTruceFalseMerges: 0,
      graphNodes: 0,
      graphEdges: 0,
    });
    expect(report.caseAccuracy).toBe(1);
  });
});
