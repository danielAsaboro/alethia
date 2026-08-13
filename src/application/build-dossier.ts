import type {
  AnswerValueGroup,
  ClaimObservation,
  ConsolidatedClaim,
} from "@/domain/evidence";
import type {
  Claim,
  CoverageAssessment,
  EvidenceConflict,
  IdentityAssessment,
  Verdict,
  VerdictDossier,
} from "@/domain/ontology";
import { groupAnswerValues } from "@/claims/group-answers";
import { decideVerdict } from "@/verdicts/decide-verdict";

export interface DossierInput {
  question: string;
  claims: Claim[];
  observations?: ClaimObservation[];
  conflicts: EvidenceConflict[];
  coverage: CoverageAssessment;
  identity: IdentityAssessment;
  sourceLabels: Record<string, string>;
}

export interface EvidenceDossier {
  question: string;
  verdict: Verdict;
  reason: VerdictDossier["reason"];
  answerClaims: Claim[];
  answerGroups: AnswerValueGroup[];
  evidence: Array<{ claim: Claim; sourceLabel: string }>;
  conflicts: EvidenceConflict[];
  coverage: CoverageAssessment;
}

export function buildDossier(input: DossierInput): EvidenceDossier {
  const verdict = decideVerdict(input);
  const answerIds = new Set(verdict.answerClaimIds);
  const answerClaims = input.claims.filter((claim) => answerIds.has(claim.id));
  const observationsByClaimId = new Map<string, string[]>();
  for (const observation of input.observations ?? []) {
    const claimId = observation.claimCandidate.id;
    const ids = observationsByClaimId.get(claimId) ?? [];
    ids.push(observation.id);
    observationsByClaimId.set(claimId, ids);
  }
  const groupedClaims: ConsolidatedClaim[] = answerClaims.map((claim) => ({
    ...claim,
    observationIds:
      "observationIds" in claim && Array.isArray(claim.observationIds)
        ? claim.observationIds
        : (observationsByClaimId.get(claim.id) ?? [claim.id]),
  }));
  return {
    question: input.question,
    verdict: verdict.verdict,
    reason: verdict.reason,
    answerClaims,
    answerGroups: groupAnswerValues({
      claims: groupedClaims,
      observations: input.observations ?? [],
      corroborations: [],
    }),
    evidence: input.claims.map((claim) => ({
      claim,
      sourceLabel:
        input.sourceLabels[claim.sourceObjectId] ?? claim.sourceObjectId,
    })),
    conflicts: input.conflicts,
    coverage: input.coverage,
  };
}
