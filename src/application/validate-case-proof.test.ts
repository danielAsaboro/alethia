import { describe, expect, it } from "vitest";

import type { CaseWorkspace } from "./run-case";
import { validateCaseProof } from "./validate-case-proof";

function workspace(): CaseWorkspace {
  return {
    case: {
      id: "proof-case",
      kind: "conflict",
      behavior: "resolved_conflict",
      title: "Proof",
      question: "Q?",
      summary: "S",
      dataset: "ERB",
      version: "v1",
    },
    verdict: "SUPPORTED",
    answer: "answer",
    evidence: [{ source: "drive · doc-1", quote: "answer" }],
    decision: { status: "resolved", reason: "policy" },
    coverage: { sufficient: true, detail: "complete" },
    counterfactual: "new evidence",
    traversal: "Claim → Observation → Source",
    ablation: { label: "none", result: "disputed" },
    graphProof: {
      operation: "algo.SPpaths.sequence",
      consistency: "strong",
      queryId: "live-query-1",
      queryIds: ["live-query-1"],
      readEpoch: 4,
      bookmark: "sgk:test:4",
      latencyMs: 1,
      roundTrips: 1,
      pathLength: 1,
      path: "claim-1 → source-1",
      relationshipTypes: ["SUPPORTED_BY"],
      nodes: [
        { logicalId: "claim-1", labels: ["Claim"] },
        { logicalId: "source-1", labels: ["SourceObject"] },
      ],
    },
  };
}

describe("validateCaseProof", () => {
  it("rejects a live path that does not contain the required relationship sequence", () => {
    expect(() => validateCaseProof(workspace(), {
      sourceLogicalId: "claim-1",
      targetLogicalId: "source-1",
      sourceLabel: "Claim",
      targetLabel: "SourceObject",
      relationshipTypes: ["HAS_OBSERVATION", "SUPPORTED_BY"],
      minimumPathLength: 2,
      maximumPathLength: 2,
    })).toThrow(/graph proof/i);
  });

  it("accepts an exact live path with matching endpoint IDs and labels", () => {
    const candidate = workspace();
    candidate.graphProof = {
      ...candidate.graphProof,
      pathLength: 2,
      path: "claim-1 → observation-1 → source-1",
      relationshipTypes: ["HAS_OBSERVATION", "SUPPORTED_BY"],
      nodes: [
        { logicalId: "claim-1", labels: ["Claim"] },
        { logicalId: "observation-1", labels: ["ExtractionObservation"] },
        { logicalId: "source-1", labels: ["SourceObject"] },
      ],
    };

    expect(validateCaseProof(candidate, {
      sourceLogicalId: "claim-1",
      targetLogicalId: "source-1",
      sourceLabel: "Claim",
      targetLabel: "SourceObject",
      relationshipTypes: ["HAS_OBSERVATION", "SUPPORTED_BY"],
      minimumPathLength: 2,
      maximumPathLength: 2,
    })).toBe(candidate);
  });

  it("rejects a composite proof that reuses a query ID", () => {
    const candidate = workspace();
    candidate.graphProof = {
      ...candidate.graphProof,
      roundTrips: 2,
      queryIds: ["duplicate-query", "duplicate-query"],
    };

    expect(() => validateCaseProof(candidate, {
      sourceLogicalId: "claim-1",
      targetLogicalId: "source-1",
      sourceLabel: "Claim",
      targetLabel: "SourceObject",
      relationshipTypes: ["SUPPORTED_BY"],
      minimumPathLength: 1,
      maximumPathLength: 1,
    })).toThrow(/graph proof/i);
  });
});
