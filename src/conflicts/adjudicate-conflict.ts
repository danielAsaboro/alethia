import type { Claim } from "@/domain/ontology";

export type ClaimLifecycle =
  | "proposal"
  | "approved"
  | "applied"
  | "deprecated"
  | "unknown";

export interface AdjudicationClaim {
  claim: Claim;
  lifecycle: ClaimLifecycle;
  lifecycleGrounded: boolean;
}

export type AdjudicationPolicy =
  | {
      id: string;
      kind: "source_authority";
      predicate: string;
      priorities: Record<string, number>;
    }
  | {
      id: string;
      kind: "lifecycle_precedence";
      predicate: string;
      order: ClaimLifecycle[];
    }
  | {
      id: string;
      kind: "recency";
      predicate: string;
    };

export interface AdjudicationResult {
  conflictId: string;
  status: "resolved" | "unresolved";
  winningClaimId?: string;
  losingClaimIds: string[];
  policyId?: string;
  decisiveFactors: string[];
  unresolvedReason?: "no_matching_policy" | "no_decisive_rule";
}

function resolved(
  conflictId: string,
  winner: AdjudicationClaim,
  loser: AdjudicationClaim,
  policyId: string,
  decisiveFactor: string,
): AdjudicationResult {
  return {
    conflictId,
    status: "resolved",
    winningClaimId: winner.claim.id,
    losingClaimIds: [loser.claim.id],
    policyId,
    decisiveFactors: [decisiveFactor],
  };
}

export function adjudicateConflict(
  conflict: {
    id: string;
    left: AdjudicationClaim;
    right: AdjudicationClaim;
  },
  policies: AdjudicationPolicy[],
): AdjudicationResult {
  const predicate = conflict.left.claim.predicate;
  if (
    predicate !== conflict.right.claim.predicate ||
    conflict.left.claim.subjectEntityId !== conflict.right.claim.subjectEntityId
  ) {
    throw new TypeError("Adjudication claims must share subject and predicate");
  }
  const matching = policies.filter((policy) => policy.predicate === predicate);
  if (matching.length === 0) {
    return {
      conflictId: conflict.id,
      status: "unresolved",
      losingClaimIds: [],
      decisiveFactors: [],
      unresolvedReason: "no_matching_policy",
    };
  }

  for (const policy of matching.filter(
    (candidate) => candidate.kind === "source_authority",
  )) {
    if (policy.kind !== "source_authority") continue;
    const leftPriority = policy.priorities[conflict.left.claim.sourceSystem];
    const rightPriority = policy.priorities[conflict.right.claim.sourceSystem];
    if (
      leftPriority !== undefined &&
      rightPriority !== undefined &&
      leftPriority !== rightPriority
    ) {
      const leftWins = leftPriority > rightPriority;
      return resolved(
        conflict.id,
        leftWins ? conflict.left : conflict.right,
        leftWins ? conflict.right : conflict.left,
        policy.id,
        `source_authority:${
          leftWins
            ? `${conflict.left.claim.sourceSystem}>${conflict.right.claim.sourceSystem}`
            : `${conflict.right.claim.sourceSystem}>${conflict.left.claim.sourceSystem}`
        }`,
      );
    }
  }

  for (const policy of matching.filter(
    (candidate) => candidate.kind === "lifecycle_precedence",
  )) {
    if (
      policy.kind !== "lifecycle_precedence" ||
      !conflict.left.lifecycleGrounded ||
      !conflict.right.lifecycleGrounded
    ) {
      continue;
    }
    const leftRank = policy.order.indexOf(conflict.left.lifecycle);
    const rightRank = policy.order.indexOf(conflict.right.lifecycle);
    if (leftRank >= 0 && rightRank >= 0 && leftRank !== rightRank) {
      const leftWins = leftRank > rightRank;
      return resolved(
        conflict.id,
        leftWins ? conflict.left : conflict.right,
        leftWins ? conflict.right : conflict.left,
        policy.id,
        `lifecycle:${
          leftWins
            ? `${conflict.left.lifecycle}>${conflict.right.lifecycle}`
            : `${conflict.right.lifecycle}>${conflict.left.lifecycle}`
        }`,
      );
    }
  }

  for (const policy of matching.filter(
    (candidate) => candidate.kind === "recency",
  )) {
    if (policy.kind !== "recency") continue;
    const leftTime = Date.parse(conflict.left.claim.observedAt ?? "");
    const rightTime = Date.parse(conflict.right.claim.observedAt ?? "");
    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      const leftWins = leftTime > rightTime;
      return resolved(
        conflict.id,
        leftWins ? conflict.left : conflict.right,
        leftWins ? conflict.right : conflict.left,
        policy.id,
        `recency:${leftWins ? "left>right" : "right>left"}`,
      );
    }
  }

  return {
    conflictId: conflict.id,
    status: "unresolved",
    losingClaimIds: [],
    decisiveFactors: [],
    unresolvedReason: "no_decisive_rule",
  };
}
