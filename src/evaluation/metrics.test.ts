import { describe, expect, it } from "vitest";

import { evaluateCases, evaluatePairs, scoreAttemptsV2 } from "./metrics";

describe("evaluateCases", () => {
  it("reports verdict accuracy, evidence quality, latency, and confusion", () => {
    const report = evaluateCases([
      {
        expectedVerdict: "SUPPORTED",
        actualVerdict: "SUPPORTED",
        expectedEvidenceIds: ["a", "b"],
        actualEvidenceIds: ["a", "b", "extra"],
        latencyMs: 10,
      },
      {
        expectedVerdict: "UNKNOWN",
        actualVerdict: "NOT_FOUND",
        expectedEvidenceIds: [],
        actualEvidenceIds: [],
        latencyMs: 30,
      },
    ]);

    expect(report).toEqual({
      cases: 2,
      verdictAccuracy: 0.5,
      evidenceRecall: 1,
      invalidExtraEvidenceRate: 1 / 3,
      p50LatencyMs: 10,
      p95LatencyMs: 30,
      confusion: {
        SUPPORTED: { SUPPORTED: 1 },
        UNKNOWN: { NOT_FOUND: 1 },
      },
    });
  });

  it("uses honest zero-denominator conventions", () => {
    expect(evaluateCases([])).toMatchObject({
      cases: 0,
      verdictAccuracy: 0,
      evidenceRecall: null,
      invalidExtraEvidenceRate: null,
    });
  });
});

describe("evaluatePairs", () => {
  it("reports pairwise precision, recall, and f1", () => {
    expect(
      evaluatePairs(
        new Set(["a|b", "c|d"]),
        new Set(["a|b", "x|y"]),
      ),
    ).toEqual({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    });
  });
});

describe("scoreAttemptsV2", () => {
  it("keeps every attempt status in counts and scores structured outcomes", () => {
    const report = scoreAttemptsV2(
      [
        {
          schemaVersion: 2,
          caseId: "completed",
          status: "completed",
          latencyMs: 10,
          verdict: "SUPPORTED",
          facts: [{ kind: "percentage", value: 30 }],
          evidenceDocumentIds: ["doc-a", "extra"],
          relationships: ["ASSERTS", "SUPPORTED_BY"],
          coverageState: "complete",
          conflictState: "resolved",
          grounding: { accepted: 2, rejected: 0 },
          graphProofs: [{ queryId: "query-1", live: true, relationshipTypes: ["ASSERTS", "SUPPORTED_BY"], pathLength: 2 }],
        },
        { schemaVersion: 2, caseId: "rejected", status: "rejected", latencyMs: 20, reason: "malformed_output" },
        { schemaVersion: 2, caseId: "failed", status: "failed", latencyMs: 30, error: "Hydra unavailable" },
        { schemaVersion: 2, caseId: "unscored", status: "completed", latencyMs: 40, verdict: "UNKNOWN", facts: [], evidenceDocumentIds: [], relationships: [], coverageState: "partial", conflictState: "not_applicable", grounding: { accepted: 0, rejected: 0 }, graphProofs: [] },
      ],
      [
        {
          caseId: "completed",
          expectedVerdict: "SUPPORTED",
          expectedFacts: [{ kind: "percentage", value: 30 }],
          expectedEvidenceDocumentIds: ["doc-a"],
          expectedRelationships: ["ASSERTS", "SUPPORTED_BY"],
          forbiddenRelationships: ["DECIDED_BY"],
          requiredCoverageState: "complete",
          expectedConflictState: "resolved",
          requiredGraphProof: { requiredRelationships: ["ASSERTS", "SUPPORTED_BY"], minimumPathLength: 2, maximumPathLength: 2, requireLiveQueryId: true },
          expectedIdentityState: "not_applicable",
          expectedAlignmentState: "not_applicable",
        },
        {
          caseId: "rejected",
          expectedVerdict: "UNKNOWN",
          expectedFacts: [],
          expectedEvidenceDocumentIds: [],
          expectedRelationships: [],
          forbiddenRelationships: [],
          requiredCoverageState: "not_applicable",
          expectedConflictState: "not_applicable",
          requiredGraphProof: { requiredRelationships: [], requireLiveQueryId: false },
          expectedIdentityState: "not_applicable",
          expectedAlignmentState: "not_applicable",
        },
        {
          caseId: "failed",
          expectedVerdict: "UNKNOWN",
          expectedFacts: [],
          expectedEvidenceDocumentIds: [],
          expectedRelationships: [],
          forbiddenRelationships: [],
          requiredCoverageState: "not_applicable",
          expectedConflictState: "not_applicable",
          requiredGraphProof: { requiredRelationships: [], requireLiveQueryId: false },
          expectedIdentityState: "not_applicable",
          expectedAlignmentState: "not_applicable",
        },
      ],
    );

    expect(report.counts).toEqual({
      attempted: 4,
      completed: 2,
      rejected: 1,
      failed: 1,
      unscored: 1,
    });
    expect(report.answerCorrectness).toBe(1 / 3);
    expect(report.answerCompleteness).toBe(1 / 3);
    expect(report.verdictAccuracy).toBe(1 / 3);
    expect(report.evidence).toEqual({ precision: 0.5, recall: 1, f1: 2 / 3, invalidExtraEvidenceRate: 0.5 });
    expect(report.grounding).toEqual({ accepted: 2, rejected: 0, acceptanceRate: 1, rejectionRate: 0 });
    expect(report.latency).toEqual({ p50Ms: 20, p95Ms: 40 });
  });

  it("rejects reordered or extra graph relationships instead of treating them as a set", () => {
    const report = scoreAttemptsV2([{
      schemaVersion: 2,
      caseId: "ordered-path",
      status: "completed",
      latencyMs: 1,
      verdict: "SUPPORTED",
      facts: [],
      evidenceDocumentIds: [],
      relationships: ["SUPPORTED_BY", "HAS_OBSERVATION", "ASSERTS"],
      coverageState: "complete",
      conflictState: "not_applicable",
      grounding: { accepted: 0, rejected: 0 },
      graphProofs: [{
        queryId: "query-live",
        live: true,
        relationshipTypes: ["SUPPORTED_BY", "HAS_OBSERVATION", "ASSERTS"],
        pathLength: 3,
      }],
    }], [{
      caseId: "ordered-path",
      expectedVerdict: "SUPPORTED",
      expectedFacts: [],
      expectedEvidenceDocumentIds: [],
      expectedRelationships: ["ASSERTS", "HAS_OBSERVATION", "SUPPORTED_BY"],
      forbiddenRelationships: [],
      requiredCoverageState: "complete",
      expectedConflictState: "not_applicable",
      requiredGraphProof: {
        requiredRelationships: ["ASSERTS", "HAS_OBSERVATION", "SUPPORTED_BY"],
        minimumPathLength: 3,
        maximumPathLength: 3,
        requireLiveQueryId: true,
      },
      expectedIdentityState: "not_applicable",
      expectedAlignmentState: "not_applicable",
    }]);

    expect(report.relationshipAccuracy).toBe(0);
    expect(report.graphProofAccuracy).toBe(0);
  });
});
