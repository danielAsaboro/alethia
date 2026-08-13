import { describe, expect, it } from "vitest";

import type { Claim } from "@/domain/ontology";
import { compareClaims, type AuthorityPolicy } from "./authority-policy";

function claim(
  id: string,
  sourceSystem: string,
  value: string,
  observedAt?: string,
): Claim {
  return {
    id,
    subjectEntityId: "entity_pr_42",
    predicate: "merge_status",
    object: { kind: "literal", value },
    sourceObjectId: `source_${id}`,
    sourceSystem,
    extractionMethod: "deterministic",
    extractorVersion: "structural-v1",
    observedAt,
  };
}

const policies: AuthorityPolicy[] = [
  {
    id: "policy_github_merge_status",
    predicate: "merge_status",
    sourceSystem: "github",
    priority: 100,
    rationale: "GitHub owns pull-request merge state",
  },
  {
    id: "policy_slack_merge_status",
    predicate: "merge_status",
    sourceSystem: "slack",
    priority: 20,
    rationale: "Slack discussion is non-authoritative for merge state",
  },
];

describe("compareClaims", () => {
  it("uses authority scoped to the predicate instead of a global source tier", () => {
    expect(
      compareClaims(
        claim("claim_github", "github", "merged"),
        claim("claim_slack", "slack", "open"),
        policies,
      ),
    ).toEqual({
      relationship: "contradicts",
      resolution: "left",
      policyId: "policy_github_merge_status",
      reason: "predicate_authority",
    });
  });

  it("uses recency only when authority is comparable", () => {
    const sameAuthority: AuthorityPolicy[] = [
      {
        id: "policy_jira_issue_status",
        predicate: "merge_status",
        sourceSystem: "jira",
        priority: 80,
        rationale: "Comparable Jira status records",
      },
    ];
    expect(
      compareClaims(
        claim("claim_old", "jira", "open", "2026-08-10T10:00:00Z"),
        claim("claim_new", "jira", "closed", "2026-08-12T10:00:00Z"),
        sameAuthority,
      ),
    ).toEqual({
      relationship: "contradicts",
      resolution: "right",
      policyId: "policy_jira_issue_status",
      reason: "comparable_authority_recency",
    });
  });

  it("leaves different values unresolved when no authority policy applies", () => {
    expect(
      compareClaims(
        claim("claim_email", "gmail", "merged", "2026-08-12T10:00:00Z"),
        claim("claim_chat", "slack", "open", "2026-08-13T10:00:00Z"),
        [],
      ),
    ).toEqual({
      relationship: "contradicts",
      resolution: "unresolved",
      reason: "authority_incomparable",
    });
  });

  it("recognizes identical values as corroborating evidence", () => {
    expect(
      compareClaims(
        claim("claim_github", "github", "merged"),
        claim("claim_slack", "slack", "merged"),
        policies,
      ),
    ).toEqual({
      relationship: "corroborates",
      resolution: "unresolved",
      reason: "objects_equal",
    });
  });
});
