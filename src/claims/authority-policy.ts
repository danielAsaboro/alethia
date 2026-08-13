import type { Claim } from "@/domain/ontology";

export interface AuthorityPolicy {
  id: string;
  predicate: string;
  sourceSystem: string;
  priority: number;
  rationale: string;
}

export interface ClaimComparison {
  relationship: "corroborates" | "contradicts";
  resolution: "left" | "right" | "unresolved";
  policyId?: string;
  reason:
    | "objects_equal"
    | "predicate_authority"
    | "comparable_authority_recency"
    | "authority_incomparable";
}

function objectsEqual(left: Claim, right: Claim): boolean {
  if (left.object.kind !== right.object.kind) return false;
  if (left.object.kind === "entity" && right.object.kind === "entity") {
    return left.object.entityId === right.object.entityId;
  }
  if (left.object.kind === "literal" && right.object.kind === "literal") {
    return (
      left.object.value === right.object.value &&
      left.object.datatype === right.object.datatype
    );
  }
  return false;
}

export function compareClaims(
  left: Claim,
  right: Claim,
  policies: AuthorityPolicy[],
): ClaimComparison {
  if (
    left.subjectEntityId !== right.subjectEntityId ||
    left.predicate !== right.predicate
  ) {
    throw new TypeError("Claims must share a subject and predicate");
  }

  if (objectsEqual(left, right)) {
    return {
      relationship: "corroborates",
      resolution: "unresolved",
      reason: "objects_equal",
    };
  }

  const leftPolicy = policies.find(
    (policy) =>
      policy.predicate === left.predicate &&
      policy.sourceSystem === left.sourceSystem,
  );
  const rightPolicy = policies.find(
    (policy) =>
      policy.predicate === right.predicate &&
      policy.sourceSystem === right.sourceSystem,
  );

  if (!leftPolicy || !rightPolicy) {
    return {
      relationship: "contradicts",
      resolution: "unresolved",
      reason: "authority_incomparable",
    };
  }

  if (leftPolicy.priority !== rightPolicy.priority) {
    const leftWins = leftPolicy.priority > rightPolicy.priority;
    return {
      relationship: "contradicts",
      resolution: leftWins ? "left" : "right",
      policyId: leftWins ? leftPolicy.id : rightPolicy.id,
      reason: "predicate_authority",
    };
  }

  if (left.observedAt && right.observedAt) {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      return {
        relationship: "contradicts",
        resolution: leftTime > rightTime ? "left" : "right",
        policyId: leftTime > rightTime ? leftPolicy.id : rightPolicy.id,
        reason: "comparable_authority_recency",
      };
    }
  }

  return {
    relationship: "contradicts",
    resolution: "unresolved",
    reason: "authority_incomparable",
  };
}
