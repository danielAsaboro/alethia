import { describe, expect, it } from "vitest";

import type { EvaluationAttemptV2, EvaluationLabelsV2, EvaluationRuntimeManifestV2 } from "./contract";
import { freezeHoldout, runFrozenHoldout, scoreFrozenHoldout } from "./holdout";

const runtime: EvaluationRuntimeManifestV2 = {
  schemaVersion: 2,
  cases: [{ id: "holdout-1", question: "What is recorded?", category: "simple_lookup", execution: { sourceSystems: ["github"] } }],
};

const attempt: EvaluationAttemptV2 = {
  schemaVersion: 2,
  caseId: "holdout-1",
  status: "failed",
  latencyMs: 4,
  error: "preserved failure",
};

const labels: EvaluationLabelsV2 = {
  schemaVersion: 2,
  labels: [{
    caseId: "holdout-1",
    expectedVerdict: "SUPPORTED",
    expectedFacts: [],
    expectedEvidenceDocumentIds: [],
    expectedRelationships: [],
    forbiddenRelationships: [],
    requiredCoverageState: "complete",
    expectedConflictState: "none",
    requiredGraphProof: { requiredRelationships: [], requireLiveQueryId: true },
    expectedIdentityState: "not_applicable",
    expectedAlignmentState: "not_applicable",
  }],
};

function freeze() {
  return freezeHoldout({
    runtime,
    publicCommit: "a".repeat(40),
    acquisitionDigest: "b".repeat(64),
    extractionPromptVersion: "grounded-answer-v1",
    retrievalConfigDigest: "c".repeat(64),
    policyVersions: ["coverage-v1", "conflict-v1"],
    model: { alias: "alethia-extractor", sha256: "d".repeat(64), contextSize: 16384 },
  });
}

describe("holdout state machine", () => {
  it("rejects gold-bearing runtime input", () => {
    expect(() => freezeHoldout({
      runtime: { ...runtime, cases: [{ ...runtime.cases[0], execution: { goldAnswer: "secret" } }] },
      publicCommit: "a".repeat(40), acquisitionDigest: "b".repeat(64), extractionPromptVersion: "v1",
      retrievalConfigDigest: "c".repeat(64), policyVersions: [], model: { alias: "m", sha256: "d".repeat(64), contextSize: 1 },
    })).toThrow(/goldAnswer/i);
  });

  it("detects a tampered freeze before execution", () => {
    const frozen = freeze();
    expect(() => runFrozenHoldout({ ...frozen, publicCommit: "e".repeat(40) }, [attempt])).toThrow(/digest mismatch/i);
  });

  it("requires execution before scoring and preserves failed attempts", () => {
    expect(() => scoreFrozenHoldout(freeze(), labels)).toThrow(/must be executed/i);
    const executed = runFrozenHoldout(freeze(), [attempt]);
    const scored = scoreFrozenHoldout(executed, labels);
    expect(scored.state).toBe("scored");
    expect(scored.report.counts).toMatchObject({ attempted: 1, failed: 1 });
  });

  it("detects tampered attempt bytes before scoring", () => {
    const executed = runFrozenHoldout(freeze(), [attempt]);
    expect(() => scoreFrozenHoldout({ ...executed, attempts: [{ ...attempt, error: "changed" }] }, labels)).toThrow(/digest mismatch/i);
  });
});
