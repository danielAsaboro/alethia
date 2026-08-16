import { createHash } from "node:crypto";

import { stableId } from "@/domain/ids";
import type { SourceSchemaTerm } from "./source-terms";

export interface OntologyTerm {
  id: string;
  name: string;
  domain: string;
  range: string;
}

export interface AlignmentRule {
  id: string;
  version: string;
  sourceSystem: string;
  objectType: string;
  surface: string;
  contextualRole: string;
  targetOntologyTermId: string;
  domain: string;
  range: string;
}

export interface AlignmentDecision {
  id: string;
  sourceTermId: string;
  candidateOntologyTermId: string;
  evidenceObservationIds: string[];
  constraints: string[];
  inputDigest: string;
  policyId?: string;
  policyVersion?: string;
  status: "accepted" | "rejected" | "pending";
  reason:
    | "exact_registry_rule"
    | "domain_range_mismatch"
    | "no_exact_registry_rule";
}

export function decideAlignment(
  input: {
    term: SourceSchemaTerm;
    candidate: OntologyTerm;
    evidenceObservationIds: string[];
  },
  rules: AlignmentRule[],
): AlignmentDecision {
  const rule = rules.find(
    (candidate) =>
      candidate.sourceSystem === input.term.sourceSystem &&
      candidate.objectType === input.term.objectType &&
      candidate.surface === input.term.normalizedSurface &&
      candidate.contextualRole === input.term.contextualRole,
  );
  const identity = {
    sourceTermId: input.term.id,
    candidateOntologyTermId: input.candidate.id,
    evidenceObservationIds: [...input.evidenceObservationIds].sort(),
  };
  const decisionKey = {
    ...identity,
    policyId: rule?.id ?? null,
    policyVersion: rule?.version ?? null,
  };
  const inputDigest = createHash("sha256")
    .update(JSON.stringify({
      term: input.term,
      candidate: input.candidate,
      evidenceObservationIds: identity.evidenceObservationIds,
      rule: rule ?? null,
      algorithmVersion: "alignment-policy-v1",
    }))
    .digest("hex");
  if (!rule) {
    return {
      id: stableId("alignment_decision", { ...decisionKey, status: "pending" }),
      ...identity,
      inputDigest,
      constraints: ["exact_registry_rule_required"],
      status: "pending",
      reason: "no_exact_registry_rule",
    };
  }
  if (
    rule.targetOntologyTermId !== input.candidate.id ||
    rule.domain !== input.candidate.domain ||
    rule.range !== input.candidate.range
  ) {
    return {
      id: stableId("alignment_decision", { ...decisionKey, status: "rejected" }),
      ...identity,
      inputDigest,
      policyId: rule.id,
      policyVersion: rule.version,
      constraints: [
        `required_domain:${rule.domain}`,
        `required_range:${rule.range}`,
        `required_target:${rule.targetOntologyTermId}`,
      ],
      status: "rejected",
      reason: "domain_range_mismatch",
    };
  }
  return {
    id: stableId("alignment_decision", { ...decisionKey, status: "accepted" }),
    ...identity,
    inputDigest,
    policyId: rule.id,
    policyVersion: rule.version,
    constraints: ["source_context_exact", "domain_range_compatible"],
    status: "accepted",
    reason: "exact_registry_rule",
  };
}
