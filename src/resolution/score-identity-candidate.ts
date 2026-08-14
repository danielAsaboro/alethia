import { stableId } from "@/domain/ids";

export interface IdentitySignal {
  kind: "verified_email_exact" | "verified_account_link" | "external_id_exact" | "name_similarity" | "neighborhood_overlap";
  value: string;
  weight: number;
}

export interface IdentityConstraint {
  kind: "verified_email_conflict" | "employee_id_conflict" | "cluster_identity_conflict";
  leftValue: string;
  rightValue: string;
}

export interface IdentityCandidateDecision {
  id: string;
  candidateSourceObjectIds: [string, string];
  signals: IdentitySignal[];
  constraints: IdentityConstraint[];
  status: "accepted" | "rejected" | "pending";
  score: number;
  algorithmVersion: "identity-scorer-v1";
}

export function scoreIdentityCandidate(input: {
  candidateSourceObjectIds: [string, string];
  signals: IdentitySignal[];
  constraints: IdentityConstraint[];
}): IdentityCandidateDecision {
  const hardBlocked = input.constraints.length > 0;
  const verified = input.signals.some((signal) =>
    signal.kind === "verified_email_exact" ||
    signal.kind === "verified_account_link" ||
    signal.kind === "external_id_exact",
  );
  const status = hardBlocked ? "rejected" : verified ? "accepted" : "pending";
  const score = hardBlocked
    ? 0
    : verified
      ? 1
      : Math.min(0.89, input.signals.reduce((sum, signal) => sum + signal.weight, 0) / Math.max(1, input.signals.length));
  return {
    id: stableId("identity_candidate_decision", {
      algorithmVersion: "identity-scorer-v1",
      candidateSourceObjectIds: input.candidateSourceObjectIds,
      signals: input.signals,
      constraints: input.constraints,
      status,
    }),
    ...input,
    status,
    score,
    algorithmVersion: "identity-scorer-v1",
  };
}
