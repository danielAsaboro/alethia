import { describe, expect, it } from "vitest";
import { scoreFirstPrizeResults, type FrozenCaseResult } from "./run-first-prize-evaluation";

describe("first-prize evaluation separation", () => {
  it("scores only after receiving frozen runtime workspaces", () => {
    const result: FrozenCaseResult = {
      caseId: "streamly-credit-conflict", status: "completed", latencyMs: 4,
      workspace: {
        case: { id: "streamly-credit-conflict", kind: "conflict", title: "x", question: "q", summary: "s", dataset: "ERB", version: "v" },
        verdict: "SUPPORTED", answer: "30%", evidence: [{ source: "s", quote: "q" }, { source: "t", quote: "r" }],
        decision: { status: "resolved", reason: "policy" }, coverage: { sufficient: true, detail: "complete" },
        counterfactual: "later claim", traversal: "graph", ablation: { label: "none", result: "disputed" },
      },
    };
    const report = scoreFirstPrizeResults([result], { records: 698, acceptedExactLinks: 18, sameNameCandidates: 1645, hardNegativePairs: 1627, sourceTruceFalseMerges: 0, graphNodes: 12378, graphEdges: 22906 });
    expect(report.caseAccuracy).toBe(1);
    expect(report.lanes.identity.naiveFuzzyFalseMerges).toBe(1627);
    expect(JSON.stringify(result)).not.toMatch(/gold_answer|answer_facts|expected_doc_ids/);
  });
});
