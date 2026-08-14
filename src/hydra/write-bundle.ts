import { stableId } from "@/domain/ids";
import type { Claim } from "@/domain/ontology";
import type { IngestionBundle } from "@/ingestion/source-adapter";
import { identityKey } from "@/resolution/normalize-identity";
import type {
  GraphEdge,
  GraphNode,
  GraphRelationshipType,
  GraphWriteBundle,
} from "./client";

function edge(input: Omit<GraphEdge, "logicalId" | "properties"> & {
  via?: string;
  properties?: GraphEdge["properties"];
}): GraphEdge {
  const identity = {
    type: input.type,
    sourceLogicalId: input.sourceLogicalId,
    targetLogicalId: input.targetLogicalId,
    ...(input.via ? { via: input.via } : {}),
  };
  return {
    logicalId: stableId("edge", identity),
    type: input.type,
    sourceLabel: input.sourceLabel,
    sourceLogicalId: input.sourceLogicalId,
    targetLabel: input.targetLabel,
    targetLogicalId: input.targetLogicalId,
    properties: input.properties ?? {},
  };
}

function domainRelationship(claim: Claim): GraphRelationshipType | null {
  switch (claim.predicate) {
    case "member_of":
    case "works_at":
      return "MEMBER_OF";
    case "has_team_member":
      return "HAS_TEAM_MEMBER";
    case "serves_customer":
      return "SERVES_CUSTOMER";
    case "manages":
      return "MANAGES";
    default:
      return null;
  }
}

export function mapIngestionToGraph(
  ingestion: IngestionBundle,
): GraphWriteBundle {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const entityBySourceObjectId = new Map<string, string>();

  for (const sourceObject of ingestion.records) {
    nodes.push({
      logicalId: sourceObject.id,
      label: "SourceObject",
      properties: {
        sourceSystem: sourceObject.sourceSystem,
        objectType: sourceObject.sourceObjectType,
        nativeId: sourceObject.sourceNativeId,
        payloadDigest: sourceObject.payloadDigest,
        fieldsJson: JSON.stringify(sourceObject.fields),
      },
    });
    for (const identity of sourceObject.identities) {
      const identityId = stableId("identity", { key: identityKey(identity) });
      nodes.push({
        logicalId: identityId,
        label: "Identity",
        properties: {
          kind: identity.kind,
          normalizedValue: identity.normalizedValue,
          sourceSystem: identity.sourceSystem,
        },
      });
      edges.push(edge({
        type: "HAS_IDENTITY",
        sourceLabel: "SourceObject",
        sourceLogicalId: sourceObject.id,
        targetLabel: "Identity",
        targetLogicalId: identityId,
      }));
    }
  }

  for (const entity of ingestion.resolution.entities) {
    const objectTypes = [
      ...new Set(
        entity.sourceObjectIds
          .map(
            (id) =>
              ingestion.records.find((record) => record.id === id)
                ?.sourceObjectType,
          )
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort();
    nodes.push({
      logicalId: entity.id,
      label: "Entity",
      properties: {
        kind: objectTypes.includes("product") ? "product" : "person",
        sourceObjectCount: entity.sourceObjectIds.length,
        identityKeysJson: JSON.stringify(entity.identityKeys),
      },
    });
    for (const sourceObjectId of entity.sourceObjectIds) {
      entityBySourceObjectId.set(sourceObjectId, entity.id);
      edges.push(
        edge({
          type: "RESOLVES_TO",
          sourceLabel: "SourceObject",
          sourceLogicalId: sourceObjectId,
          targetLabel: "Entity",
          targetLogicalId: entity.id,
        }),
      );
    }
  }

  for (const entity of ingestion.extraction.referencedEntities) {
    nodes.push({
      logicalId: entity.id,
      label: "Entity",
      properties: { kind: entity.kind, name: entity.name },
    });
  }

  const runIds = new Set<string>();
  for (const coverage of ingestion.coverage) {
    if (!runIds.has(coverage.ingestionRunId)) {
      runIds.add(coverage.ingestionRunId);
      nodes.push({
        logicalId: coverage.ingestionRunId,
        label: "IngestionRun",
        properties: {
          adapterVersion: ingestion.adapter.version,
          sourceSystem: coverage.sourceSystem,
        },
      });
    }
    nodes.push({
      logicalId: coverage.id,
      label: "CoverageSlice",
      properties: {
        sourceSystem: coverage.sourceSystem,
        objectType: coverage.objectType,
        status: coverage.status,
        contentScope: coverage.contentScope,
        predicateFamiliesJson: JSON.stringify(coverage.predicateFamilies),
      },
    });
    edges.push(
      edge({
        type: "COVERS",
        sourceLabel: "IngestionRun",
        sourceLogicalId: coverage.ingestionRunId,
        targetLabel: "CoverageSlice",
        targetLogicalId: coverage.id,
      }),
    );
  }

  const runByObjectType = new Map(
    ingestion.coverage.map((slice) => [slice.objectType, slice.ingestionRunId]),
  );
  for (const sourceObject of ingestion.records) {
    const runId = runByObjectType.get(sourceObject.sourceObjectType);
    if (runId) {
      edges.push(
        edge({
          type: "OBSERVED_IN",
          sourceLabel: "SourceObject",
          sourceLogicalId: sourceObject.id,
          targetLabel: "IngestionRun",
          targetLogicalId: runId,
        }),
      );
    }
  }

  for (const decision of ingestion.resolution.decisions) {
    nodes.push({
      logicalId: decision.id,
      label: "ResolutionDecision",
      properties: {
        status: decision.status,
        confidence: decision.confidence,
        algorithmVersion: decision.algorithmVersion,
        signalsJson: JSON.stringify(decision.signals),
        constraintsJson: JSON.stringify(decision.constraints),
      },
    });
    for (const [index, signal] of decision.signals.entries()) {
      const signalId = stableId("resolution_signal", { decisionId: decision.id, index, signal });
      nodes.push({
        logicalId: signalId,
        label: "ResolutionSignal",
        properties: { kind: signal.kind, normalizedValue: signal.normalizedValue },
      });
      edges.push(edge({
        type: "SUPPORTED_BY",
        sourceLabel: "ResolutionDecision",
        sourceLogicalId: decision.id,
        targetLabel: "ResolutionSignal",
        targetLogicalId: signalId,
      }));
    }
    for (const constraint of decision.constraints.filter((value) =>
      value.endsWith("_conflict") || value === "name_not_unique",
    )) {
      const constraintId = stableId("resolution_constraint", { decisionId: decision.id, constraint });
      nodes.push({
        logicalId: constraintId,
        label: "ResolutionConstraint",
        properties: { kind: constraint },
      });
      edges.push(edge({
        type: "BLOCKED_BY",
        sourceLabel: "ResolutionDecision",
        sourceLogicalId: decision.id,
        targetLabel: "ResolutionConstraint",
        targetLogicalId: constraintId,
      }));
    }
    for (const sourceObjectId of decision.candidateSourceObjectIds) {
      edges.push(
        edge({
          type: "CONSIDERS",
          sourceLabel: "ResolutionDecision",
          sourceLogicalId: decision.id,
          targetLabel: "SourceObject",
          targetLogicalId: sourceObjectId,
        }),
      );
    }
    if (decision.status === "accepted") {
      const targetEntityId = entityBySourceObjectId.get(
        decision.candidateSourceObjectIds[0],
      );
      if (targetEntityId) {
        edges.push(
          edge({
            type: "RESOLVES_TO",
            sourceLabel: "ResolutionDecision",
            sourceLogicalId: decision.id,
            targetLabel: "Entity",
            targetLogicalId: targetEntityId,
          }),
        );
      }
    }
  }

  for (const claim of ingestion.extraction.claims) {
    nodes.push({
      logicalId: claim.id,
      label: "Claim",
      properties: {
        predicate: claim.predicate,
        objectJson: JSON.stringify(claim.object),
        sourceSystem: claim.sourceSystem,
        extractionMethod: claim.extractionMethod,
        extractorVersion: claim.extractorVersion,
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
    const type = domainRelationship(claim);
    if (type && claim.object.kind === "entity") {
      edges.push(
        edge({
          type,
          sourceLabel: "Entity",
          sourceLogicalId: claim.subjectEntityId,
          targetLabel: "Entity",
          targetLogicalId: claim.object.entityId,
          via: claim.id,
          properties: { claimId: claim.id },
        }),
      );
    }
  }

  return {
    nodes: [...new Map(nodes.map((node) => [`${node.label}:${node.logicalId}`, node])).values()],
    edges: [...new Map(edges.map((item) => [item.logicalId, item])).values()],
  };
}
