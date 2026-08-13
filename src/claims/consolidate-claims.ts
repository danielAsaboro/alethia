import type {
  ClaimCorroboration,
  ClaimObservation,
  ConsolidatedClaim,
  ConsolidatedClaims,
} from "@/domain/evidence";
import { stableId } from "@/domain/ids";
import type { Claim } from "@/domain/ontology";

export function semanticClaimId(claim: Claim): string {
  return stableId("claim", {
    subjectEntityId: claim.subjectEntityId,
    predicate: claim.predicate,
    object: claim.object,
    sourceObjectId: claim.sourceObjectId,
    validFrom: claim.validFrom ?? null,
    validTo: claim.validTo ?? null,
  });
}

function corroborationKey(claim: Claim): string {
  return stableId("corroboration_key", {
    subjectEntityId: claim.subjectEntityId,
    predicate: claim.predicate,
    object: claim.object,
    validFrom: claim.validFrom ?? null,
    validTo: claim.validTo ?? null,
  });
}

function buildCorroborations(claims: ConsolidatedClaim[]): ClaimCorroboration[] {
  const claimsByValue = new Map<string, ConsolidatedClaim[]>();
  for (const claim of claims) {
    const key = corroborationKey(claim);
    const group = claimsByValue.get(key) ?? [];
    group.push(claim);
    claimsByValue.set(key, group);
  }

  const corroborations: ClaimCorroboration[] = [];
  for (const group of claimsByValue.values()) {
    const ordered = [...group].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ordered.length;
        rightIndex += 1
      ) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        if (left.sourceObjectId !== right.sourceObjectId) {
          corroborations.push({ leftClaimId: left.id, rightClaimId: right.id });
        }
      }
    }
  }
  return corroborations;
}

export function consolidateClaims(
  inputObservations: ClaimObservation[],
): ConsolidatedClaims {
  const observations = [...inputObservations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((observation) => {
      const id = semanticClaimId(observation.claimCandidate);
      return {
        ...observation,
        claimCandidate: { ...observation.claimCandidate, id },
      };
    });
  const claimsById = new Map<string, ConsolidatedClaim>();

  for (const observation of observations) {
    const candidate = observation.claimCandidate;
    const existing = claimsById.get(candidate.id);
    if (existing) {
      existing.observationIds.push(observation.id);
      continue;
    }
    claimsById.set(candidate.id, {
      ...candidate,
      observationIds: [observation.id],
    });
  }

  const claims = [...claimsById.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return {
    claims,
    observations,
    corroborations: buildCorroborations(claims),
  };
}
