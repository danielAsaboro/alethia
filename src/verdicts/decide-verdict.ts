import type { VerdictDossier, VerdictInput } from "@/domain/ontology";

export function decideVerdict(input: VerdictInput): VerdictDossier {
  const evidenceClaimIds = input.claims.map((claim) => claim.id);
  const conflictIds = input.conflicts.map((conflict) => conflict.id);

  if (input.identity.status !== "resolved") {
    return {
      verdict: "UNKNOWN",
      reason:
        input.identity.status === "ambiguous"
          ? "identity_ambiguous"
          : "identity_missing",
      answerClaimIds: [],
      evidenceClaimIds,
      conflictIds,
      missingCoverage: input.coverage.missing,
    };
  }

  const unresolvedConflict = input.conflicts.some(
    (conflict) => conflict.resolution === "unresolved",
  );
  if (unresolvedConflict) {
    return {
      verdict: "DISPUTED",
      reason: "claims_disputed",
      answerClaimIds: [],
      evidenceClaimIds,
      conflictIds,
      missingCoverage: input.coverage.missing,
    };
  }

  if (input.claims.length === 0) {
    return input.coverage.sufficient
      ? {
          verdict: "NOT_FOUND",
          reason: "evidence_absent",
          answerClaimIds: [],
          evidenceClaimIds: [],
          conflictIds,
          missingCoverage: [],
        }
      : {
          verdict: "UNKNOWN",
          reason: "coverage_incomplete",
          answerClaimIds: [],
          evidenceClaimIds: [],
          conflictIds,
          missingCoverage: input.coverage.missing,
        };
  }

  const losingClaimIds = new Set<string>();
  for (const conflict of input.conflicts) {
    if (conflict.resolution === "left") {
      losingClaimIds.add(conflict.rightClaimId);
    } else if (conflict.resolution === "right") {
      losingClaimIds.add(conflict.leftClaimId);
    }
  }

  return {
    verdict: "SUPPORTED",
    reason: "claim_supported",
    answerClaimIds: evidenceClaimIds.filter((id) => !losingClaimIds.has(id)),
    evidenceClaimIds,
    conflictIds,
    missingCoverage: input.coverage.missing,
  };
}
