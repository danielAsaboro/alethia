import type {
  Claim,
  CoverageAssessment,
  EvidenceConflict,
  IdentityAssessment,
  Verdict,
  VerdictDossier,
} from "@/domain/ontology";
import { decideVerdict } from "@/verdicts/decide-verdict";

export interface DossierInput {
  question: string;
  claims: Claim[];
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
  evidence: Array<{ claim: Claim; sourceLabel: string }>;
  conflicts: EvidenceConflict[];
  coverage: CoverageAssessment;
}

export function buildDossier(input: DossierInput): EvidenceDossier {
  const verdict = decideVerdict(input);
  const answerIds = new Set(verdict.answerClaimIds);
  return {
    question: input.question,
    verdict: verdict.verdict,
    reason: verdict.reason,
    answerClaims: input.claims.filter((claim) => answerIds.has(claim.id)),
    evidence: input.claims.map((claim) => ({
      claim,
      sourceLabel:
        input.sourceLabels[claim.sourceObjectId] ?? claim.sourceObjectId,
    })),
    conflicts: input.conflicts,
    coverage: input.coverage,
  };
}
