import type { AuthorityPolicy } from "@/claims/authority-policy";
import type {
  AlignmentDecision,
  OntologyTerm,
} from "@/alignment/alignment-policy";
import type { SourceSchemaTerm } from "@/alignment/source-terms";
import type {
  ClaimCorroboration,
  ClaimObservation,
  ConsolidatedClaim,
} from "@/domain/evidence";
import { stableId } from "@/domain/ids";
import type { EvidenceConflict } from "@/domain/ontology";
import type { GraphEdge, GraphNode, GraphWriteBundle } from "./client";

export interface EvidenceGraphSource {
  id: string;
  sourceSystem: string;
  sourceNativeId: string;
  payloadDigest: string;
}

export interface EvidenceGraphSourceRelation {
  type: "VERSION_OF" | "DUPLICATE_OF" | "MISFILED_AS";
  sourceObjectId: string;
  targetSourceObjectId: string;
  reason: string;
  orderKnown?: boolean;
}

export interface EvidenceGraphInput {
  claims: ConsolidatedClaim[];
  observations: ClaimObservation[];
  sources: EvidenceGraphSource[];
  sourceRelations?: EvidenceGraphSourceRelation[];
  corroborations?: ClaimCorroboration[];
  conflicts: EvidenceConflict[];
  policies: AuthorityPolicy[];
  alignment?: {
    sourceTerms: SourceSchemaTerm[];
    ontologyTerms: OntologyTerm[];
    decisions: AlignmentDecision[];
    observations: Array<{
      sourceObjectId: string;
      sourceTermId: string;
    }>;
  };
}

function edge(
  input: Omit<GraphEdge, "logicalId" | "properties"> & {
    discriminator?: string;
    properties?: GraphEdge["properties"];
  },
): GraphEdge {
  return {
    logicalId: stableId("edge", {
      type: input.type,
      sourceLogicalId: input.sourceLogicalId,
      targetLogicalId: input.targetLogicalId,
      discriminator: input.discriminator ?? null,
    }),
    type: input.type,
    sourceLabel: input.sourceLabel,
    sourceLogicalId: input.sourceLogicalId,
    targetLabel: input.targetLabel,
    targetLogicalId: input.targetLogicalId,
    properties: input.properties ?? {},
  };
}

export function mapEvidenceSystemToGraph(
  input: EvidenceGraphInput,
): GraphWriteBundle {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const sourceIds = new Set(input.sources.map((source) => source.id));
  const claimIds = new Set(input.claims.map((claim) => claim.id));
  const policyIds = new Set(input.policies.map((policy) => policy.id));

  for (const source of input.sources) {
    nodes.set(source.id, {
      logicalId: source.id,
      label: "SourceObject",
      properties: {
        sourceSystem: source.sourceSystem,
        nativeId: source.sourceNativeId,
        payloadDigest: source.payloadDigest,
      },
    });
  }

  for (const relation of input.sourceRelations ?? []) {
    if (
      !sourceIds.has(relation.sourceObjectId) ||
      !sourceIds.has(relation.targetSourceObjectId)
    ) {
      throw new TypeError(
        `Source relation references a missing source: ${relation.sourceObjectId} -> ${relation.targetSourceObjectId}`,
      );
    }
    edges.push(
      edge({
        type: relation.type,
        sourceLabel: "SourceObject",
        sourceLogicalId: relation.sourceObjectId,
        targetLabel: "SourceObject",
        targetLogicalId: relation.targetSourceObjectId,
        properties: {
          reason: relation.reason,
          orderKnown: relation.orderKnown ?? false,
        },
      }),
    );
  }

  for (const policy of input.policies) {
    nodes.set(policy.id, {
      logicalId: policy.id,
      label: "AuthorityPolicy",
      properties: {
        predicate: policy.predicate,
        sourceSystem: policy.sourceSystem,
        priority: policy.priority,
        rationale: policy.rationale,
      },
    });
  }

  for (const claim of input.claims) {
    if (!sourceIds.has(claim.sourceObjectId)) {
      throw new TypeError(`Claim source is missing: ${claim.sourceObjectId}`);
    }
    nodes.set(claim.subjectEntityId, {
      logicalId: claim.subjectEntityId,
      label: "Entity",
      properties: { kind: "evidence_subject" },
    });
    nodes.set(claim.id, {
      logicalId: claim.id,
      label: "Claim",
      properties: {
        predicate: claim.predicate,
        objectJson: JSON.stringify(claim.object),
        sourceSystem: claim.sourceSystem,
        validFrom: claim.validFrom ?? "",
        validTo: claim.validTo ?? "",
        observedAt: claim.observedAt ?? "",
        observationCount: claim.observationIds.length,
      },
    });
    edges.push(
      edge({
        type: "ASSERTS",
        sourceLabel: "Entity",
        sourceLogicalId: claim.subjectEntityId,
        targetLabel: "Claim",
        targetLogicalId: claim.id,
      }),
      edge({
        type: "SUPPORTED_BY",
        sourceLabel: "Claim",
        sourceLogicalId: claim.id,
        targetLabel: "SourceObject",
        targetLogicalId: claim.sourceObjectId,
      }),
    );
  }

  for (const observation of input.observations) {
    const claimId = observation.claimCandidate.id;
    if (!claimIds.has(claimId)) {
      throw new TypeError(`Observation claim is missing: ${claimId}`);
    }
    if (!sourceIds.has(observation.claimCandidate.sourceObjectId)) {
      throw new TypeError(
        `Observation source is missing: ${observation.claimCandidate.sourceObjectId}`,
      );
    }
    nodes.set(observation.id, {
      logicalId: observation.id,
      label: "ExtractionObservation",
      properties: {
        method: observation.method,
        extractorVersion: observation.extractorVersion,
        evidenceQuote: observation.evidenceQuote ?? "",
      },
    });
    edges.push(
      edge({
        type: "HAS_OBSERVATION",
        sourceLabel: "Claim",
        sourceLogicalId: claimId,
        targetLabel: "ExtractionObservation",
        targetLogicalId: observation.id,
        discriminator: observation.id,
      }),
      edge({
        type: "SUPPORTED_BY",
        sourceLabel: "ExtractionObservation",
        sourceLogicalId: observation.id,
        targetLabel: "SourceObject",
        targetLogicalId: observation.claimCandidate.sourceObjectId,
      }),
    );
  }

  for (const corroboration of input.corroborations ?? []) {
    edges.push(
      edge({
        type: "CORROBORATES",
        sourceLabel: "Claim",
        sourceLogicalId: corroboration.leftClaimId,
        targetLabel: "Claim",
        targetLogicalId: corroboration.rightClaimId,
      }),
    );
  }

  for (const conflict of input.conflicts) {
    if (
      !claimIds.has(conflict.leftClaimId) ||
      !claimIds.has(conflict.rightClaimId)
    ) {
      throw new TypeError(`Conflict references a missing claim: ${conflict.id}`);
    }
    nodes.set(conflict.id, {
      logicalId: conflict.id,
      label: "Conflict",
      properties: {
        resolution: conflict.resolution,
        policyId: conflict.policyId ?? "",
      },
    });
    edges.push(
      edge({
        type: "CONTRADICTS",
        sourceLabel: "Claim",
        sourceLogicalId: conflict.leftClaimId,
        targetLabel: "Claim",
        targetLogicalId: conflict.rightClaimId,
        discriminator: conflict.id,
        properties: { conflictId: conflict.id },
      }),
      edge({
        type: "CONSIDERS",
        sourceLabel: "Conflict",
        sourceLogicalId: conflict.id,
        targetLabel: "Claim",
        targetLogicalId: conflict.leftClaimId,
        discriminator: "left",
        properties: { side: "left" },
      }),
      edge({
        type: "CONSIDERS",
        sourceLabel: "Conflict",
        sourceLogicalId: conflict.id,
        targetLabel: "Claim",
        targetLogicalId: conflict.rightClaimId,
        discriminator: "right",
        properties: { side: "right" },
      }),
    );
    if (conflict.policyId) {
      if (!policyIds.has(conflict.policyId)) {
        throw new TypeError(`Conflict policy is missing: ${conflict.policyId}`);
      }
      edges.push(
        edge({
          type: "DECIDED_BY",
          sourceLabel: "Conflict",
          sourceLogicalId: conflict.id,
          targetLabel: "AuthorityPolicy",
          targetLogicalId: conflict.policyId,
        }),
      );
    }
  }

  if (input.alignment) {
    const sourceTermIds = new Set(
      input.alignment.sourceTerms.map((term) => term.id),
    );
    const ontologyTermIds = new Set(
      input.alignment.ontologyTerms.map((term) => term.id),
    );
    for (const term of input.alignment.sourceTerms) {
      nodes.set(term.id, {
        logicalId: term.id,
        label: "SourceSchemaTerm",
        properties: {
          sourceSystem: term.sourceSystem,
          objectType: term.objectType,
          surface: term.surface,
          normalizedSurface: term.normalizedSurface,
          contextualRole: term.contextualRole,
          canonicalHint: term.canonicalHint,
        },
      });
    }
    for (const term of input.alignment.ontologyTerms) {
      nodes.set(term.id, {
        logicalId: term.id,
        label: "OntologyTerm",
        properties: {
          name: term.name,
          domain: term.domain,
          range: term.range,
        },
      });
    }
    for (const observation of input.alignment.observations) {
      if (
        !sourceIds.has(observation.sourceObjectId) ||
        !sourceTermIds.has(observation.sourceTermId)
      ) {
        throw new TypeError("Alignment observation references a missing node");
      }
      edges.push(
        edge({
          type: "OBSERVED_AS",
          sourceLabel: "SourceObject",
          sourceLogicalId: observation.sourceObjectId,
          targetLabel: "SourceSchemaTerm",
          targetLogicalId: observation.sourceTermId,
        }),
      );
    }
    for (const decision of input.alignment.decisions) {
      if (
        !sourceTermIds.has(decision.sourceTermId) ||
        !ontologyTermIds.has(decision.candidateOntologyTermId)
      ) {
        throw new TypeError(`Alignment decision references a missing term: ${decision.id}`);
      }
      nodes.set(decision.id, {
        logicalId: decision.id,
        label: "AlignmentDecision",
        properties: {
          sourceTermId: decision.sourceTermId,
          candidateOntologyTermId: decision.candidateOntologyTermId,
          status: decision.status,
          reason: decision.reason,
          policyId: decision.policyId ?? "",
          policyVersion: decision.policyVersion ?? "",
          constraintsJson: JSON.stringify(decision.constraints),
          evidenceObservationIdsJson: JSON.stringify(
            decision.evidenceObservationIds,
          ),
          inputDigest: decision.inputDigest,
        },
      });
      edges.push(
        edge({
          type: "CONSIDERS",
          sourceLabel: "AlignmentDecision",
          sourceLogicalId: decision.id,
          targetLabel: "SourceSchemaTerm",
          targetLogicalId: decision.sourceTermId,
        }),
        edge({
          type: "CONSIDERS",
          sourceLabel: "AlignmentDecision",
          sourceLogicalId: decision.id,
          targetLabel: "OntologyTerm",
          targetLogicalId: decision.candidateOntologyTermId,
        }),
      );
      if (decision.status === "accepted") {
        edges.push(
          edge({
            type: "MAPS_TO",
            sourceLabel: "SourceSchemaTerm",
            sourceLogicalId: decision.sourceTermId,
            targetLabel: "OntologyTerm",
            targetLogicalId: decision.candidateOntologyTermId,
            discriminator: decision.id,
            properties: { decisionId: decision.id },
          }),
        );
      } else if (decision.status === "rejected") {
        edges.push(
          edge({
            type: "REJECTED_MAPPING",
            sourceLabel: "AlignmentDecision",
            sourceLogicalId: decision.id,
            targetLabel: "OntologyTerm",
            targetLogicalId: decision.candidateOntologyTermId,
            properties: { reason: decision.reason },
          }),
        );
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}
