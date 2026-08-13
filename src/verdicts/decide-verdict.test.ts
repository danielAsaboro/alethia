import { describe, expect, it } from "vitest";

import type {
  Claim,
  CoverageAssessment,
  EvidenceConflict,
} from "@/domain/ontology";
import { decideVerdict } from "./decide-verdict";

const completeCoverage: CoverageAssessment = {
  sufficient: true,
  missing: [],
};

const incompleteCoverage: CoverageAssessment = {
  sufficient: false,
  missing: [
    {
      sourceSystem: "github",
      objectType: "pull_request",
      predicateFamily: "merge_status",
      reason: "predicate_not_examined",
    },
  ],
};

function claim(id: string, value: string): Claim {
  return {
    id,
    subjectEntityId: "entity_pr_42",
    predicate: "merge_status",
    object: { kind: "literal", value },
    sourceObjectId: `source_${id}`,
    sourceSystem: "github",
    extractionMethod: "deterministic",
    extractorVersion: "structural-v1",
  };
}

function conflict(resolution: EvidenceConflict["resolution"]): EvidenceConflict {
  return {
    id: "conflict_status",
    leftClaimId: "claim_open",
    rightClaimId: "claim_merged",
    resolution,
    policyId: resolution === "right" ? "policy_github_merge_status" : undefined,
  };
}

describe("decideVerdict", () => {
  it("supports an uncontested applicable claim", () => {
    const result = decideVerdict({
      claims: [claim("claim_merged", "merged")],
      conflicts: [],
      coverage: completeCoverage,
      identity: { status: "resolved", entityId: "entity_pr_42" },
    });

    expect(result).toMatchObject({
      verdict: "SUPPORTED",
      answerClaimIds: ["claim_merged"],
      evidenceClaimIds: ["claim_merged"],
      conflictIds: [],
      missingCoverage: [],
    });
  });

  it("preserves unresolved incompatible claims as disputed", () => {
    const result = decideVerdict({
      claims: [claim("claim_open", "open"), claim("claim_merged", "merged")],
      conflicts: [conflict("unresolved")],
      coverage: completeCoverage,
      identity: { status: "resolved", entityId: "entity_pr_42" },
    });

    expect(result).toMatchObject({
      verdict: "DISPUTED",
      answerClaimIds: [],
      evidenceClaimIds: ["claim_open", "claim_merged"],
      conflictIds: ["conflict_status"],
    });
  });

  it("supports the policy winner while retaining the losing evidence", () => {
    const result = decideVerdict({
      claims: [claim("claim_open", "open"), claim("claim_merged", "merged")],
      conflicts: [conflict("right")],
      coverage: completeCoverage,
      identity: { status: "resolved", entityId: "entity_pr_42" },
    });

    expect(result).toMatchObject({
      verdict: "SUPPORTED",
      answerClaimIds: ["claim_merged"],
      evidenceClaimIds: ["claim_open", "claim_merged"],
      conflictIds: ["conflict_status"],
    });
  });

  it("returns not found only when required coverage is sufficient", () => {
    expect(
      decideVerdict({
        claims: [],
        conflicts: [],
        coverage: completeCoverage,
        identity: { status: "resolved", entityId: "entity_pr_42" },
      }),
    ).toMatchObject({ verdict: "NOT_FOUND", missingCoverage: [] });
  });

  it("returns unknown when evidence coverage is incomplete", () => {
    expect(
      decideVerdict({
        claims: [],
        conflicts: [],
        coverage: incompleteCoverage,
        identity: { status: "resolved", entityId: "entity_pr_42" },
      }),
    ).toMatchObject({
      verdict: "UNKNOWN",
      reason: "coverage_incomplete",
      missingCoverage: incompleteCoverage.missing,
    });
  });

  it("returns unknown when identity resolution is ambiguous", () => {
    expect(
      decideVerdict({
        claims: [claim("claim_merged", "merged")],
        conflicts: [],
        coverage: completeCoverage,
        identity: {
          status: "ambiguous",
          candidateEntityIds: ["entity_pr_42", "entity_pr_420"],
        },
      }),
    ).toMatchObject({
      verdict: "UNKNOWN",
      reason: "identity_ambiguous",
      answerClaimIds: [],
    });
  });
});
