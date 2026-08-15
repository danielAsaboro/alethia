import { consolidateClaims } from "@/claims/consolidate-claims";
import type { ClaimObservation } from "@/domain/evidence";
import { stableId } from "@/domain/ids";
import type { EvidenceConflict } from "@/domain/ontology";
import {
  adjudicateConflict,
  type AdjudicationClaim,
  type AdjudicationPolicy,
  type ClaimLifecycle,
} from "./adjudicate-conflict";
import { classifyClaimPair } from "./classify-conflicts";

export interface AcceptedConflictExtraction {
  cacheKey: string;
  status: "accepted";
  sourceObjectId: string;
  sourceNativeId: string;
  sourceSystem: string;
  sourceTitle?: string;
  sourceDigest: string;
  observation: {
    subject: string;
    predicate: string;
    value: string | number | boolean;
    evidenceQuote: string;
    lifecycle: ClaimLifecycle;
  };
}

export type PromotedConflict =
  | { status: "skipped"; questionId: string; reason: string }
  | {
      status: "resolved" | "unresolved";
      questionId: string;
      question: string;
      subjectEntityId: string;
      conflict: EvidenceConflict;
      winningValue?: string;
      losingClaimIds: string[];
      claims: ReturnType<typeof consolidateClaims>["claims"];
      observations: ReturnType<typeof consolidateClaims>["observations"];
      accepted: AcceptedConflictExtraction[];
      policy: AdjudicationPolicy;
    };

const lifecyclePolicy: AdjudicationPolicy = {
  id: "policy_lifecycle_precedence_v1",
  kind: "lifecycle_precedence",
  predicate: "conflict_answer",
  order: ["deprecated", "proposal", "approved", "applied"],
};

const groundedSupersessionPolicy: AdjudicationPolicy = {
  id: "policy_grounded_supersession_v2",
  kind: "lifecycle_precedence",
  predicate: "conflict_answer",
  order: ["deprecated", "proposal", "approved", "applied"],
};

function precedenceScore(extraction: AcceptedConflictExtraction): number {
  const quote = extraction.observation.evidenceQuote;
  const title = extraction.sourceTitle ?? "";
  const lifecycleScore = {
    deprecated: -3,
    proposal: 0,
    approved: 2,
    applied: 3,
    unknown: 0,
  }[extraction.observation.lifecycle];
  const explicitSupersession =
    /correct(?:ion|ed)|deprecated|replaced|supersed|outdated|old doc|\bwas\b|previous(?:ly)?/i.test(quote)
      ? 5
      : 0;
  const currentMarker =
    /\bnow\b|\bupdated\b|\bcurrent\b|effective|finalized|post-merge/i.test(quote)
      ? 3
      : 0;
  const titleCurrent =
    (/post-merge/i.test(title) ? 4 : 0) +
    (/\bcurrent\b|\bfinal\b|\b2026\b|\bv\d+\b/i.test(title) ? 2 : 0);
  const titleDraft = /draft|scratchpad|meeting|\b2025\b|initial/i.test(title)
    ? -2
    : 0;
  return lifecycleScore + explicitSupersession + currentMarker + titleCurrent + titleDraft;
}

function latestEvidenceTimestamp(extraction: AcceptedConflictExtraction): number | null {
  const dates = [
    ...extraction.observation.evidenceQuote.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g),
  ]
    .map((match) => Date.parse(`${match[0]}T00:00:00Z`))
    .filter(Number.isFinite);
  return dates.length > 0 ? Math.max(...dates) : null;
}

export function normalizeAnswerValue(
  question: string,
  value: string | number | boolean,
): string | number | boolean {
  if (typeof value !== "string") return value;
  if (!/%|\bpercent(?:age)?\b/i.test(question)) return value;
  const percentage = value.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)\s*%/);
  return percentage ? percentage[0].replace(/\s+/g, "") : value;
}

export function isAcceptedConflictExtraction(
  extraction: unknown,
): extraction is AcceptedConflictExtraction {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return false;
  }
  const row = extraction as Record<string, unknown>;
  const observation = row.observation;
  return row.status === "accepted" && observation !== null && typeof observation === "object";
}

export function promoteAcceptedConflict(input: {
  questionId: string;
  question: string;
  accepted: AcceptedConflictExtraction[];
}): PromotedConflict {
  if (input.accepted.length < 2) {
    return { status: "skipped", questionId: input.questionId, reason: "needs_two_accepted_observations" };
  }
  const accepted = input.accepted.slice(0, 2);
  const subjects = new Set(
    accepted.map((extraction) => extraction.observation.subject.trim().toLowerCase()),
  );
  if (subjects.size !== 1) {
    return { status: "skipped", questionId: input.questionId, reason: "subject_mismatch" };
  }
  const subjectEntityId = stableId("entity", {
    kind: "infrastructure_pool",
    name: accepted[0].observation.subject,
  });
  const observations: ClaimObservation[] = accepted.map((extraction) => ({
    id: stableId("observation", {
      cacheKey: extraction.cacheKey,
      promptVersion: "conflict-observation-v11",
    }),
    claimCandidate: {
      id: `candidate_${extraction.cacheKey}`,
      subjectEntityId,
      predicate: "conflict_answer",
      object: {
        kind: "literal",
        value: normalizeAnswerValue(input.question, extraction.observation.value),
      },
      sourceObjectId: extraction.sourceObjectId,
      sourceSystem: extraction.sourceSystem,
      extractionMethod: "qvac",
      extractorVersion: "qvac:sourcetruce-extractor:v11",
    },
    evidenceQuote: extraction.observation.evidenceQuote,
    method: "qvac",
    extractorVersion: "qvac:sourcetruce-extractor:v11",
  }));
  const consolidated = consolidateClaims(observations);
  const adjudicationClaims = accepted.map((extraction): AdjudicationClaim => {
    const observation = consolidated.observations.find(
      (candidate) => candidate.claimCandidate.sourceObjectId === extraction.sourceObjectId,
    );
    if (!observation) throw new Error("Consolidated observation is missing");
    return {
      claim: observation.claimCandidate,
      lifecycle: extraction.observation.lifecycle,
      lifecycleGrounded: extraction.observation.lifecycle !== "unknown",
    };
  });
  const [left, right] = adjudicationClaims;
  const classification = classifyClaimPair(left.claim, right.claim);
  if (classification.kind !== "contradiction") {
    return { status: "skipped", questionId: input.questionId, reason: classification.kind };
  }
  const conflictId = stableId("conflict", {
    questionId: input.questionId,
    leftClaimId: left.claim.id,
    rightClaimId: right.claim.id,
  });
  let activePolicy = lifecyclePolicy;
  let adjudication = adjudicateConflict({ id: conflictId, left, right }, [activePolicy]);
  if (adjudication.status === "unresolved") {
    let leftScore = precedenceScore(accepted[0]);
    let rightScore = precedenceScore(accepted[1]);
    if (/\b(?:latest|current|most recent)\b/i.test(input.question)) {
      const leftTimestamp = latestEvidenceTimestamp(accepted[0]);
      const rightTimestamp = latestEvidenceTimestamp(accepted[1]);
      if (
        leftTimestamp !== null &&
        rightTimestamp !== null &&
        leftTimestamp !== rightTimestamp
      ) {
        if (leftTimestamp > rightTimestamp) leftScore += 10;
        else rightScore += 10;
      }
    }
    if (Math.abs(leftScore - rightScore) >= 2) {
      const leftWins = leftScore > rightScore;
      activePolicy = groundedSupersessionPolicy;
      adjudication = adjudicateConflict(
        {
          id: conflictId,
          left: {
            ...left,
            lifecycle: leftWins ? "applied" : "deprecated",
            lifecycleGrounded: true,
          },
          right: {
            ...right,
            lifecycle: leftWins ? "deprecated" : "applied",
            lifecycleGrounded: true,
          },
        },
        [activePolicy],
      );
    }
  }
  const resolution =
    adjudication.status === "resolved" && adjudication.winningClaimId === left.claim.id
      ? "left"
      : adjudication.status === "resolved" && adjudication.winningClaimId === right.claim.id
        ? "right"
        : "unresolved";
  const winningClaim = consolidated.claims.find((claim) => claim.id === adjudication.winningClaimId);
  const winningValue =
    winningClaim?.object.kind === "literal" ? String(winningClaim.object.value) : undefined;
  return {
    status: adjudication.status,
    questionId: input.questionId,
    question: input.question,
    subjectEntityId,
    conflict: {
      id: conflictId,
      leftClaimId: left.claim.id,
      rightClaimId: right.claim.id,
      resolution,
      policyId: adjudication.policyId,
    },
    winningValue,
    losingClaimIds: adjudication.losingClaimIds,
    claims: consolidated.claims,
    observations: consolidated.observations,
    accepted,
    policy: activePolicy,
  };
}
