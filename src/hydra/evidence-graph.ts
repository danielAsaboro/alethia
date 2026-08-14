import type { AuthorityPolicy } from "@/claims/authority-policy";
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

export interface EvidenceGraphInput {
  claims: ConsolidatedClaim[];
  observations: ClaimObservation[];
  sources: EvidenceGraphSource[];
  corroborations?: ClaimCorroboration[];
  conflicts: EvidenceConflict[];
  policies: AuthorityPolicy[];
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

  return { nodes: [...nodes.values()], edges };
}
