import { hydraIntId } from "./hydra-id";
import type { CoverageSlice } from "@/domain/ontology";

const labels = [
  "Entity",
  "Claim",
  "SourceObject",
  "CoverageSlice",
  "ResolutionDecision",
  "IngestionRun",
  "AuthorityPolicy",
] as const;
const relationshipTypes = [
  "ASSERTS",
  "SUPPORTED_BY",
  "OBSERVED_IN",
  "COVERS",
  "RESOLVES_TO",
  "DECIDED_BY",
  "CONTRADICTS",
  "SUPERSEDES",
  "DUPLICATE_OF",
  "VERSION_OF",
  "MISFILED_AS",
  "MEMBER_OF",
  "OWNS",
  "BLOCKS",
  "DEPENDS_ON",
  "CONSIDERS",
  "HAS_TEAM_MEMBER",
  "SERVES_CUSTOMER",
  "MANAGES",
] as const;

export type GraphLabel = (typeof labels)[number];
export type GraphRelationshipType = (typeof relationshipTypes)[number];

export interface GraphNode {
  logicalId: string;
  label: GraphLabel;
  properties: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  logicalId: string;
  type: GraphRelationshipType;
  sourceLabel: GraphLabel;
  sourceLogicalId: string;
  targetLabel: GraphLabel;
  targetLogicalId: string;
  properties: Record<string, string | number | boolean>;
}

export interface GraphWriteBundle {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface HydraConfig {
  httpUrl: string;
  token: string;
  graphId: string;
  namespace: string;
  cellId: string;
}

export interface GraphClaimEvidence {
  claimLogicalId: string;
  predicate: string;
  object:
    | { kind: "literal"; value: string | number | boolean }
    | { kind: "entity"; entityId: string };
  sourceLogicalId: string;
  sourceSystem: string;
  sourceNativeId: string;
}

export interface TeamMemberEvidence {
  entityLogicalId: string;
  displayName: string;
  relationshipClaimId: string;
  nameClaimId: string;
  sourceLogicalId: string;
  sourceSystem: string;
  sourceNativeId: string;
}

interface HydraValue {
  type: string;
  value: unknown;
}

interface HydraResponse {
  columns: string[];
  rows: HydraValue[][];
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return groups;
}

export function chunkRows<T>(rows: T[], size = 500): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new TypeError("Chunk size must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export class HydraRepository {
  private readonly queryUrl: string;

  constructor(private readonly config: HydraConfig) {
    this.queryUrl = `${config.httpUrl.replace(/\/$/, "")}/v1/graphs/${encodeURIComponent(config.graphId)}/query`;
  }

  async close(): Promise<void> {}

  private async query(
    cypher: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    const response = await fetch(this.queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        "X-Graph-Namespace": this.config.namespace,
      },
      body: JSON.stringify({
        cell_id: this.config.cellId,
        query: cypher,
        parameters,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HydraDB query failed (${response.status}): ${body}`);
    }
    const result = JSON.parse(body) as HydraResponse;
    return result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, index) => [column, row[index]?.value]),
      ),
    );
  }

  async writeGraph(bundle: GraphWriteBundle): Promise<void> {
    for (const [label, nodes] of groupBy(bundle.nodes, (node) => node.label)) {
      if (!labels.includes(label as GraphLabel)) {
        throw new TypeError(`Unsupported graph label: ${label}`);
      }
      const rows = nodes.map((node) => ({
        id: hydraIntId(node.logicalId),
        logicalId: node.logicalId,
        payloadJson: JSON.stringify(node.properties),
      }));
      for (const chunk of chunkRows(rows)) {
        await this.query(
          `UNWIND $rows AS row MERGE (n {id: row.id}) SET n:${label}, n.logical_id = row.logicalId, n.payload_json = row.payloadJson`,
          { rows: chunk },
        );
      }
    }

    for (const [groupKey, edges] of groupBy(
      bundle.edges,
      (edge) => `${edge.sourceLabel}|${edge.type}|${edge.targetLabel}`,
    )) {
      const [sourceLabel, type, targetLabel] = groupKey.split("|");
      if (
        !labels.includes(sourceLabel as GraphLabel) ||
        !labels.includes(targetLabel as GraphLabel) ||
        !relationshipTypes.includes(type as GraphRelationshipType)
      ) {
        throw new TypeError(`Unsupported graph edge shape: ${groupKey}`);
      }
      const rows = edges.map((edge) => ({
        id: hydraIntId(edge.logicalId),
        logicalId: edge.logicalId,
        sourceId: hydraIntId(edge.sourceLogicalId),
        targetId: hydraIntId(edge.targetLogicalId),
        payloadJson: JSON.stringify(edge.properties),
      }));
      for (const chunk of chunkRows(rows)) {
        await this.query(
          `UNWIND $rows AS row MATCH (a:${sourceLabel} {id: row.sourceId}), (b:${targetLabel} {id: row.targetId}) MERGE (a)-[r:${type} {id: row.id}]->(b) SET r.logical_id = row.logicalId, r.payload_json = row.payloadJson`,
          { rows: chunk },
        );
      }
    }
  }

  async getPresence(bundle: GraphWriteBundle): Promise<{ nodes: number; edges: number }> {
    let nodeCount = 0;
    for (const node of bundle.nodes) {
      const rows = await this.query(
        `MATCH (n:${node.label} {id: $id}) RETURN n.logical_id AS logicalId`,
        { id: hydraIntId(node.logicalId) },
      );
      if (rows[0]?.logicalId === node.logicalId) nodeCount += 1;
    }

    let edgeCount = 0;
    for (const edge of bundle.edges) {
      const rows = await this.query(
        `MATCH (a:${edge.sourceLabel} {id: $sourceId})-[r:${edge.type} {id: $id}]->(b:${edge.targetLabel} {id: $targetId}) RETURN r.logical_id AS logicalId`,
        {
          id: hydraIntId(edge.logicalId),
          sourceId: hydraIntId(edge.sourceLogicalId),
          targetId: hydraIntId(edge.targetLogicalId),
        },
      );
      if (rows[0]?.logicalId === edge.logicalId) edgeCount += 1;
    }

    return { nodes: nodeCount, edges: edgeCount };
  }

  async findEvidencePath(entityLogicalId: string): Promise<string[]> {
    const rows = await this.query(
      "MATCH (e:Entity {id: $entityId})-[:ASSERTS]->(c:Claim)-[:SUPPORTED_BY]->(s:SourceObject) RETURN e.logical_id AS entity, c.logical_id AS claim, s.logical_id AS source LIMIT 1",
      { entityId: hydraIntId(entityLogicalId) },
    );
    return rows[0]
      ? [String(rows[0].entity), String(rows[0].claim), String(rows[0].source)]
      : [];
  }

  async entityExists(entityLogicalId: string): Promise<boolean> {
    const rows = await this.query(
      "MATCH (e:Entity {id: $entityId}) RETURN e.logical_id AS entity LIMIT 1",
      { entityId: hydraIntId(entityLogicalId) },
    );
    return rows[0]?.entity === entityLogicalId;
  }

  async findClaimEvidence(
    entityLogicalId: string,
    predicate: string,
  ): Promise<GraphClaimEvidence[]> {
    const rows = await this.query(
      "MATCH (e:Entity {id: $entityId})-[:ASSERTS]->(c:Claim)-[:SUPPORTED_BY]->(s:SourceObject) RETURN c.logical_id AS claim, c.payload_json AS claimPayload, s.logical_id AS source, s.payload_json AS sourcePayload",
      { entityId: hydraIntId(entityLogicalId) },
    );

    return rows.flatMap((row) => {
      const claimPayload = JSON.parse(String(row.claimPayload)) as Record<
        string,
        unknown
      >;
      if (claimPayload.predicate !== predicate) return [];
      const sourcePayload = JSON.parse(String(row.sourcePayload)) as Record<
        string,
        unknown
      >;
      const object =
        typeof claimPayload.objectJson === "string"
          ? (JSON.parse(claimPayload.objectJson) as GraphClaimEvidence["object"])
          : ({
              kind: "literal",
              value: claimPayload.value as string | number | boolean,
            } as const);
      return [
        {
          claimLogicalId: String(row.claim),
          predicate,
          object,
          sourceLogicalId: String(row.source),
          sourceSystem: String(sourcePayload.sourceSystem ?? "unknown"),
          sourceNativeId: String(sourcePayload.nativeId ?? "unknown"),
        },
      ];
    });
  }

  async findCoverageSlices(
    sourceSystem: string,
    objectType: string,
  ): Promise<CoverageSlice[]> {
    const rows = await this.query(
      "MATCH (r:IngestionRun)-[:COVERS]->(c:CoverageSlice) RETURN r.logical_id AS run, c.logical_id AS coverage, c.payload_json AS payload",
    );
    return rows.flatMap((row) => {
      const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
      const predicateFamilies = JSON.parse(
        String(payload.predicateFamiliesJson ?? "[]"),
      ) as string[];
      if (
        payload.sourceSystem !== sourceSystem ||
        payload.objectType !== objectType
      ) {
        return [];
      }
      return [
        {
          id: String(row.coverage),
          ingestionRunId: String(row.run),
          sourceSystem,
          objectType,
          predicateFamilies,
          contentScope: String(payload.contentScope) as CoverageSlice["contentScope"],
          status: String(payload.status) as CoverageSlice["status"],
        },
      ];
    });
  }

  async findTeamMemberEvidence(
    productEntityLogicalId: string,
  ): Promise<TeamMemberEvidence[]> {
    const rows = await this.query(
      "MATCH (p:Entity {id: $productId})-[r:HAS_TEAM_MEMBER]->(m:Entity)-[:ASSERTS]->(c:Claim)-[:SUPPORTED_BY]->(s:SourceObject) RETURN m.logical_id AS member, r.payload_json AS relationshipPayload, c.logical_id AS claim, c.payload_json AS claimPayload, s.logical_id AS source, s.payload_json AS sourcePayload",
      { productId: hydraIntId(productEntityLogicalId) },
    );
    const byMember = new Map<string, TeamMemberEvidence>();
    for (const row of rows) {
      const claimPayload = JSON.parse(String(row.claimPayload)) as Record<
        string,
        unknown
      >;
      if (claimPayload.predicate !== "display_name") continue;
      const relationshipPayload = JSON.parse(
        String(row.relationshipPayload ?? "{}"),
      ) as Record<string, unknown>;
      const sourcePayload = JSON.parse(String(row.sourcePayload)) as Record<
        string,
        unknown
      >;
      const claimObject =
        typeof claimPayload.objectJson === "string"
          ? (JSON.parse(claimPayload.objectJson) as Record<string, unknown>)
          : undefined;
      const member = String(row.member);
      if (!byMember.has(member)) {
        byMember.set(member, {
          entityLogicalId: member,
          displayName: String(claimObject?.value ?? claimPayload.value ?? "Unknown"),
          relationshipClaimId: String(relationshipPayload.claimId ?? ""),
          nameClaimId: String(row.claim),
          sourceLogicalId: String(row.source),
          sourceSystem: String(sourcePayload.sourceSystem ?? "unknown"),
          sourceNativeId: String(sourcePayload.nativeId ?? "unknown"),
        });
      }
    }
    return [...byMember.values()].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.entityLogicalId.localeCompare(right.entityLogicalId),
    );
  }
}
