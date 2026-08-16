import type { PromotedConflict } from "./promote-erb-conflict";

type CompletedPromotion = Exclude<PromotedConflict, { status: "skipped" }>;

export interface UnresolvedConflictSeed {
  questionId: string;
  question: string;
  entityId: string;
  conflictId: string;
  resolution: "unresolved";
  resolutionReason:
    | "equal_lifecycle_without_authority"
    | "insufficient_lifecycle_without_authority";
  values: string[];
  evidence: Array<{
    sourceObjectId: string;
    sourceNativeId: string;
    sourceSystem: string;
    exactQuote: string;
    value: string;
  }>;
  policyId?: string;
  winningClaimId?: string;
  wouldResolveWith: string[];
}

function completedPromotion(
  promotions: PromotedConflict[],
  questionId: string,
): CompletedPromotion {
  const promotion = promotions.find((item) => item.questionId === questionId);
  if (!promotion || promotion.status === "skipped") {
    throw new Error(`${questionId} has no promotable conflict`);
  }
  return promotion;
}

export function selectUnresolvedConflictSeed(
  promotions: PromotedConflict[],
  questionId: string,
): UnresolvedConflictSeed {
  const promotion = completedPromotion(promotions, questionId);
  if (
    promotion.status !== "unresolved" ||
    promotion.conflict.resolution !== "unresolved" ||
    promotion.conflict.policyId ||
    promotion.winningValue !== undefined ||
    promotion.losingClaimIds.length !== 0
  ) {
    throw new Error(`${questionId} is not an unresolved conflict without a winner or policy`);
  }
  if (
    promotion.claims.length !== 2 ||
    promotion.accepted.length !== 2 ||
    new Set(promotion.accepted.map((item) => item.sourceObjectId)).size !== 2
  ) {
    throw new Error(`${questionId} must contain exactly two independently sourced claims`);
  }

  const values = promotion.accepted.map((item) => String(item.observation.value).trim());
  if (values.some((value) => value === "") || new Set(values).size !== 2) {
    throw new Error(`${questionId} does not contain two contradictory values`);
  }
  for (const [index, item] of promotion.accepted.entries()) {
    const value = values[index];
    if (!value || !item.observation.evidenceQuote.includes(value)) {
      throw new Error(`${questionId} contains a value that is not exactly quoted`);
    }
  }

  const lifecycles = promotion.accepted.map((item) => item.observation.lifecycle);
  const allGrounded = lifecycles.every((lifecycle) => lifecycle !== "unknown");
  const equalLifecycle = new Set(lifecycles).size === 1;
  if (allGrounded && !equalLifecycle) {
    throw new Error(`${questionId} has decisive lifecycle evidence and is not defensibly unresolved`);
  }

  return {
    questionId: promotion.questionId,
    question: promotion.question,
    entityId: promotion.subjectEntityId,
    conflictId: promotion.conflict.id,
    resolution: "unresolved",
    resolutionReason: equalLifecycle
      ? "equal_lifecycle_without_authority"
      : "insufficient_lifecycle_without_authority",
    values,
    evidence: promotion.accepted.map((item, index) => ({
      sourceObjectId: item.sourceObjectId,
      sourceNativeId: item.sourceNativeId,
      sourceSystem: item.sourceSystem,
      exactQuote: item.observation.evidenceQuote,
      value: values[index]!,
    })),
    wouldResolveWith: [
      "grounded supersession or deprecation evidence",
      "a versioned predicate-specific source-authority policy",
    ],
  };
}
