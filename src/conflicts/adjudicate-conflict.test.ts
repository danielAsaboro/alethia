import { describe, expect, it } from "vitest";

import type { Claim } from "@/domain/ontology";
import {
  adjudicateConflict,
  type AdjudicationClaim,
  type AdjudicationPolicy,
} from "./adjudicate-conflict";

function claim(
  id: string,
  sourceSystem: string,
  observedAt = "2026-03-01T00:00:00Z",
): Claim {
  return {
    id,
    subjectEntityId: "entity_pool",
    predicate: "conflict_answer",
    object: { kind: "literal", value: id === "claim_applied" ? "30%" : "20%" },
    sourceObjectId: `source_${id}`,
    sourceSystem,
    extractionMethod: "qvac",
    extractorVersion: "qvac:test",
    observedAt,
  };
}

const lifecyclePolicy: AdjudicationPolicy = {
  id: "policy_lifecycle",
  kind: "lifecycle_precedence",
  predicate: "conflict_answer",
  order: ["deprecated", "proposal", "approved", "applied"],
};

function lifecycleClaim(
  id: string,
  lifecycle: AdjudicationClaim["lifecycle"],
  lifecycleGrounded = true,
): AdjudicationClaim {
  return {
    claim: claim(id, id === "claim_applied" ? "google_drive" : "jira"),
    lifecycle,
    lifecycleGrounded,
  };
}

describe("adjudicateConflict", () => {
  it("lets a grounded applied state beat a grounded proposal when policy allows", () => {
    expect(
      adjudicateConflict(
        {
          id: "conflict_pool",
          left: lifecycleClaim("claim_applied", "applied"),
          right: lifecycleClaim("claim_proposal", "proposal"),
        },
        [lifecyclePolicy],
      ),
    ).toMatchObject({
      status: "resolved",
      winningClaimId: "claim_applied",
      losingClaimIds: ["claim_proposal"],
      policyId: "policy_lifecycle",
      decisiveFactors: ["lifecycle:applied>proposal"],
    });
  });

  it("does not use lifecycle precedence when either lifecycle is ungrounded", () => {
    expect(
      adjudicateConflict(
        {
          id: "conflict_pool",
          left: lifecycleClaim("claim_applied", "applied", false),
          right: lifecycleClaim("claim_proposal", "proposal"),
        },
        [lifecyclePolicy],
      ),
    ).toMatchObject({ status: "unresolved", unresolvedReason: "no_decisive_rule" });
  });

  it("does not let recency override higher predicate-specific source authority", () => {
    const policies: AdjudicationPolicy[] = [
      {
        id: "policy_source",
        kind: "source_authority",
        predicate: "conflict_answer",
        priorities: { jira: 100, slack: 10 },
      },
      {
        id: "policy_recency",
        kind: "recency",
        predicate: "conflict_answer",
      },
    ];
    expect(
      adjudicateConflict(
        {
          id: "conflict_authority",
          left: {
            claim: claim("claim_old", "jira", "2026-03-01T00:00:00Z"),
            lifecycle: "unknown",
            lifecycleGrounded: false,
          },
          right: {
            claim: claim("claim_new", "slack", "2026-03-20T00:00:00Z"),
            lifecycle: "unknown",
            lifecycleGrounded: false,
          },
        },
        policies,
      ),
    ).toMatchObject({
      winningClaimId: "claim_old",
      policyId: "policy_source",
      decisiveFactors: ["source_authority:jira>slack"],
    });
  });

  it("leaves a conflict unresolved when no policy matches", () => {
    expect(
      adjudicateConflict(
        {
          id: "conflict_none",
          left: lifecycleClaim("claim_applied", "applied"),
          right: lifecycleClaim("claim_proposal", "proposal"),
        },
        [],
      ),
    ).toEqual({
      conflictId: "conflict_none",
      status: "unresolved",
      losingClaimIds: [],
      decisiveFactors: [],
      unresolvedReason: "no_matching_policy",
    });
  });
});
