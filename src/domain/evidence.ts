import type { Claim } from "@/domain/ontology";

export interface ClaimObservation {
  id: string;
  claimCandidate: Claim;
  evidenceQuote?: string;
  method: Claim["extractionMethod"];
  extractorVersion: string;
}

export interface ConsolidatedClaim extends Claim {
  observationIds: string[];
}

export interface ClaimCorroboration {
  leftClaimId: string;
  rightClaimId: string;
}

export interface ConsolidatedClaims {
  claims: ConsolidatedClaim[];
  observations: ClaimObservation[];
  corroborations: ClaimCorroboration[];
}

export interface AnswerValueGroup {
  valueLabel: string;
  claimIds: string[];
  observationIds: string[];
  sourceObjectIds: string[];
  claimCount: number;
  observationCount: number;
}
