import { describe, expect, it } from "vitest";

import type {
  Claim,
  CoverageAssessment,
  EvidenceConflict,
} from "@/domain/ontology";
import { buildDossier } from "./build-dossier";

const claim = (id: string, value: string): Claim => ({
  id,
  subjectEntityId: "entity_1",
  predicate: "has_role",
  object: { kind: "literal", value },
  sourceObjectId: `source_${id}`,
  sourceSystem: "herb",
  extractionMethod: "deterministic",
  extractorVersion: "herb-structural-v1",
});

const complete: CoverageAssessment = { sufficient: true, missing: [] };
const incomplete: CoverageAssessment = {
  sufficient: false,
  missing: [
    {
      sourceSystem: "herb",
      objectType: "employee",
      predicateFamily: "role",
      reason: "predicate_not_examined",
    },
  ],
};

describe("buildDossier", () => {
  it("retains complete evidence for a supported answer", () => {
    const evidence = claim("claim_engineer", "Software Engineer");
    expect(
      buildDossier({
        question: "What is this person's role?",
        claims: [evidence],
        conflicts: [],
        coverage: complete,
        identity: { status: "resolved", entityId: "entity_1" },
        sourceLabels: { source_claim_engineer: "HERB employee metadata" },
      }),
    ).toMatchObject({
      question: "What is this person's role?",
      verdict: "SUPPORTED",
      answerClaims: [evidence],
      evidence: [
        {
          claim: evidence,
          sourceLabel: "HERB employee metadata",
        },
      ],
      coverage: complete,
    });
  });

  it("retains both sides of an unresolved dispute", () => {
    const left = claim("claim_engineer", "Engineer");
    const right = claim("claim_manager", "Manager");
    const conflict: EvidenceConflict = {
      id: "conflict_role",
      leftClaimId: left.id,
      rightClaimId: right.id,
      resolution: "unresolved",
    };
    expect(
      buildDossier({
        question: "What is this person's role?",
        claims: [left, right],
        conflicts: [conflict],
        coverage: complete,
        identity: { status: "resolved", entityId: "entity_1" },
        sourceLabels: {},
      }),
    ).toMatchObject({
      verdict: "DISPUTED",
      answerClaims: [],
      conflicts: [conflict],
      evidence: [{ claim: left }, { claim: right }],
    });
  });

  it("distinguishes covered absence from incomplete knowledge", () => {
    const base = {
      question: "What is this person's lunch?",
      claims: [],
      conflicts: [],
      identity: { status: "resolved" as const, entityId: "entity_1" },
      sourceLabels: {},
    };
    expect(buildDossier({ ...base, coverage: complete }).verdict).toBe(
      "NOT_FOUND",
    );
    expect(buildDossier({ ...base, coverage: incomplete })).toMatchObject({
      verdict: "UNKNOWN",
      coverage: incomplete,
    });
  });
});
