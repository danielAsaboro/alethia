import { describe, expect, test } from "vitest";

import type { Claim } from "@/domain/ontology";
import {
  buildConflictEngineeringProof,
  discoverSourceOnlyConflicts,
} from "./conflict-engineering-proof";

function claim(input: {
  id: string;
  subject: string;
  value: string;
  source: string;
  sourceObject: string;
  validFrom?: string;
  validTo?: string;
}): Claim {
  return {
    id: input.id,
    subjectEntityId: input.subject,
    predicate: "configured_value",
    object: { kind: "literal", value: input.value },
    sourceObjectId: input.sourceObject,
    sourceSystem: input.source,
    extractionMethod: "qvac",
    extractorVersion: "source-fact-v1",
    validFrom: input.validFrom,
    validTo: input.validTo,
  };
}

describe("source-only conflict engineering proof", () => {
  test("discovers contradictions and supersession from claims without inventory or question fields", () => {
    const result = discoverSourceOnlyConflicts([
      claim({ id: "old", subject: "pool", value: "20%", source: "jira", sourceObject: "j1", validTo: "2026-01-02T00:00:00Z" }),
      claim({ id: "new", subject: "pool", value: "30%", source: "drive", sourceObject: "d1", validFrom: "2026-01-02T00:00:00Z" }),
      claim({ id: "other", subject: "token", value: "120", source: "wiki", sourceObject: "w1" }),
      claim({ id: "other-2", subject: "token", value: "180", source: "mail", sourceObject: "m1" }),
    ]);

    expect(result).toEqual({
      claimsInspected: 4,
      groupsInspected: 2,
      crossSourcePairsInspected: 2,
      conflicts: [
        { kind: "supersession", leftClaimId: "new", rightClaimId: "old", winningClaimId: "new", losingClaimId: "old" },
        { kind: "contradiction", leftClaimId: "other", rightClaimId: "other-2" },
      ],
    });
  });

  test("fails closed when discovery input contains question or gold inventory fields", () => {
    const clean = claim({ id: "a", subject: "s", value: "1", source: "jira", sourceObject: "j1" });
    expect(() => discoverSourceOnlyConflicts([{ ...clean, questionId: "qst_1" } as Claim]))
      .toThrow(/questionId/);
    expect(() => discoverSourceOnlyConflicts([{ ...clean, expected_doc_ids: ["j1"] } as Claim]))
      .toThrow(/expected_doc_ids/);
    expect(() => discoverSourceOnlyConflicts([{ ...clean, gold_answer: "1" } as Claim]))
      .toThrow(/gold_answer/);
  });

  test("builds conflict-only and cut-versus-pin tables without hiding weak arms", () => {
    const proof = buildConflictEngineeringProof({
      sourceOnlyDiscovery: {
        claimsInspected: 4,
        groupsInspected: 2,
        crossSourcePairsInspected: 2,
        conflicts: [{ kind: "contradiction", leftClaimId: "a", rightClaimId: "b" }],
      },
      scoredArms: {
        plain_retrieval: { answerCorrectness: 0.2, currentValueSurfaced: 2, unsupportedAnswerRate: 0, retiredValuePresentedAsCurrent: 1 },
        superseded_evidence_removal: { answerCorrectness: 0.5, currentValueSurfaced: 5, unsupportedAnswerRate: 0, retiredValuePresentedAsCurrent: 0 },
        current_evidence_pinning: { answerCorrectness: 0.4, currentValueSurfaced: 4, unsupportedAnswerRate: 0, retiredValuePresentedAsCurrent: 0 },
        full_alethia_grounding: { answerCorrectness: 0.5, currentValueSurfaced: 5, unsupportedAnswerRate: 0, retiredValuePresentedAsCurrent: 0 },
      },
      runtimeRows: [
        { caseId: "c1", armId: "plain_retrieval", contextDocumentIds: ["old", "new"], removedDocumentIds: [], replacementDocumentIds: [], hydraQueryCount: 0 },
        { caseId: "c1", armId: "superseded_evidence_removal", contextDocumentIds: ["new", "replacement"], removedDocumentIds: ["old"], replacementDocumentIds: ["replacement"], hydraQueryCount: 2 },
      ],
      topKSummaries: [
        { topK: 5, totalQuestions: 500, conflictMatches: 7, interventions: 5, unsupportedInterventions: 0 },
        { topK: 20, totalQuestions: 500, conflictMatches: 15, interventions: 11, unsupportedInterventions: 0 },
      ],
      batching: { maximumRoundTripsPerRequest: 2, allQueryIdsUnique: true, noLinearPerDocumentQueryGrowth: true },
    });

    expect(proof.conflictOnlyHeadline.map((row) => row.armId)).toEqual([
      "plain_retrieval",
      "superseded_evidence_removal",
      "current_evidence_pinning",
      "full_alethia_grounding",
    ]);
    expect(proof.cutVersusPin).toEqual({
      cut: { answerCorrectness: 0.5, currentValueSurfaced: 5 },
      pin: { answerCorrectness: 0.4, currentValueSurfaced: 4 },
      full: { answerCorrectness: 0.5, currentValueSurfaced: 5 },
      fullMinusCutCorrectness: 0,
      fullMinusPinCorrectness: 0.1,
    });
    expect(proof.retrievalTopology).toEqual({ cases: 1, rows: 2, unchangedRows: 1, cutRows: 1, replacementRows: 1, hydraQueries: 2 });
    expect(proof.topKSensitivity).toHaveLength(2);
    expect(proof.inventoryFreeMechanism).toMatchObject({ questionIdsRead: false, goldDocumentIdsRead: false, goldAnswersRead: false });
  });
});
