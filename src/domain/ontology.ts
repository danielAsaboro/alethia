export type ContentScope = "metadata" | "body" | "both";

export type CoverageStatus = "complete" | "partial" | "failed" | "skipped";

export interface CoverageSlice {
  id: string;
  ingestionRunId: string;
  sourceSystem: string;
  objectType: string;
  predicateFamilies: string[];
  contentScope: ContentScope;
  status: CoverageStatus;
  failureReason?: string;
  fromTime?: string;
  toTime?: string;
}

export interface RequiredCoverageSlice {
  sourceSystem: string;
  objectType: string;
  predicateFamily: string;
  contentScope: ContentScope;
}

export interface CoverageRequirement {
  slices: RequiredCoverageSlice[];
}

export type CoverageGapReason =
  | "slice_missing"
  | "ingestion_failed"
  | "ingestion_incomplete"
  | "predicate_not_examined"
  | "content_not_examined";

export interface CoverageGap {
  sourceSystem: string;
  objectType: string;
  predicateFamily: string;
  reason: CoverageGapReason;
}

export interface CoverageAssessment {
  sufficient: boolean;
  missing: CoverageGap[];
}

export interface LiteralClaimObject {
  kind: "literal";
  value: string | number | boolean;
  datatype?: string;
}

export interface EntityClaimObject {
  kind: "entity";
  entityId: string;
}

export type ClaimObject = LiteralClaimObject | EntityClaimObject;

export interface Claim {
  id: string;
  subjectEntityId: string;
  predicate: string;
  object: ClaimObject;
  sourceObjectId: string;
  sourceSystem: string;
  extractionMethod: "deterministic" | "qvac";
  extractorVersion: string;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
}

export interface EvidenceConflict {
  id: string;
  leftClaimId: string;
  rightClaimId: string;
  resolution: "left" | "right" | "unresolved";
  policyId?: string;
}

export type IdentityAssessment =
  | { status: "resolved"; entityId: string }
  | { status: "ambiguous"; candidateEntityIds: string[] }
  | { status: "missing" };

export type Verdict = "SUPPORTED" | "DISPUTED" | "NOT_FOUND" | "UNKNOWN";

export interface VerdictInput {
  claims: Claim[];
  conflicts: EvidenceConflict[];
  coverage: CoverageAssessment;
  identity: IdentityAssessment;
}

export interface VerdictDossier {
  verdict: Verdict;
  reason:
    | "claim_supported"
    | "claims_disputed"
    | "evidence_absent"
    | "coverage_incomplete"
    | "identity_ambiguous"
    | "identity_missing";
  answerClaimIds: string[];
  evidenceClaimIds: string[];
  conflictIds: string[];
  missingCoverage: CoverageGap[];
}
