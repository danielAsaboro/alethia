import type { Claim } from "@/domain/ontology";

export type ClaimPairClassification =
  | { kind: "equivalent_observation" }
  | { kind: "corroboration" }
  | { kind: "contradiction" }
  | { kind: "supersession"; winningClaimId: string; losingClaimId: string }
  | { kind: "incomparable"; reason: "alignment_unresolved" };

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

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function classifyClaimPair(
  left: Claim,
  right: Claim,
  options: { predicatesAligned?: boolean } = {},
): ClaimPairClassification {
  if (left.subjectEntityId !== right.subjectEntityId) {
    return { kind: "incomparable", reason: "alignment_unresolved" };
  }
  const predicatesAligned =
    left.predicate === right.predicate || options.predicatesAligned === true;
  if (!predicatesAligned) {
    return { kind: "incomparable", reason: "alignment_unresolved" };
  }
  if (objectsEqual(left, right)) {
    return left.sourceObjectId === right.sourceObjectId
      ? { kind: "equivalent_observation" }
      : { kind: "corroboration" };
  }

  const leftEnd = timestamp(left.validTo);
  const rightStart = timestamp(right.validFrom);
  if (leftEnd !== undefined && rightStart !== undefined && leftEnd <= rightStart) {
    return {
      kind: "supersession",
      winningClaimId: right.id,
      losingClaimId: left.id,
    };
  }
  const rightEnd = timestamp(right.validTo);
  const leftStart = timestamp(left.validFrom);
  if (rightEnd !== undefined && leftStart !== undefined && rightEnd <= leftStart) {
    return {
      kind: "supersession",
      winningClaimId: left.id,
      losingClaimId: right.id,
    };
  }
  return { kind: "contradiction" };
}
