import { describe, expect, it } from "vitest";

import {
  parseEvaluationLabelsV2,
  parseRuntimeManifestV2,
} from "./contract";

describe("evaluation contract v2", () => {
  it("rejects gold data recursively from runtime manifests", () => {
    expect(() =>
      parseRuntimeManifestV2({
        schemaVersion: 2,
        cases: [
          {
            id: "case-1",
            question: "Which value controls?",
            category: "conflict",
            execution: {
              sourceSystems: ["slack", "google_drive"],
              metadata: { expectedDocumentIds: ["secret-document"] },
            },
          },
        ],
      }),
    ).toThrow(/expectedDocumentIds/);
  });

  it.each([
    "goldAnswer",
    "answerFacts",
    "expectedVerdict",
    "expected_doc_ids",
    "evaluationLabel",
  ])("rejects the forbidden runtime key %s", (forbiddenKey) => {
    expect(() =>
      parseRuntimeManifestV2({
        schemaVersion: 2,
        cases: [
          {
            id: "case-1",
            question: "Q?",
            category: "simple_lookup",
            execution: { [forbiddenKey]: "secret" },
          },
        ],
      }),
    ).toThrow(new RegExp(forbiddenKey, "i"));
  });

  it("parses separate graph, coverage, conflict, identity, and alignment labels", () => {
    const labels = parseEvaluationLabelsV2({
      schemaVersion: 2,
      labels: [
        {
          caseId: "case-1",
          expectedVerdict: "DISPUTED",
          expectedFacts: [{ kind: "text", value: "unresolved" }],
          expectedEvidenceDocumentIds: ["doc-1", "doc-2"],
          expectedRelationships: ["CONTRADICTS"],
          forbiddenRelationships: ["DECIDED_BY"],
          requiredCoverageState: "complete",
          expectedConflictState: "unresolved",
          requiredGraphProof: {
            sourceLabel: "Conflict",
            targetLabel: "SourceObject",
            requiredRelationships: ["CONSIDERS", "HAS_OBSERVATION", "SUPPORTED_BY"],
            minimumPathLength: 2,
            maximumPathLength: 4,
            requireLiveQueryId: true,
          },
          expectedIdentityState: "not_applicable",
          expectedAlignmentState: "not_applicable",
        },
      ],
    });

    expect(labels.labels[0]).toMatchObject({
      caseId: "case-1",
      expectedConflictState: "unresolved",
      forbiddenRelationships: ["DECIDED_BY"],
    });
  });
});
