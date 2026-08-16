import { createHash, randomUUID } from "node:crypto";

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
  "Identity",
  "ResolutionSignal",
  "ResolutionConstraint",
  "ExtractionObservation",
  "SourceSchemaTerm",
  "OntologyTerm",
  "AlignmentDecision",
  "Conflict",
  "CounterfactualRequirement",
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
  "HAS_IDENTITY",
  "CANDIDATE_SAME_AS",
  "BLOCKED_BY",
  "HAS_OBSERVATION",
  "OBSERVED_AS",
  "MAPS_TO",
  "REJECTED_MAPPING",
  "CORROBORATES",
  "WOULD_CHANGE_IF",
  "REQUIRES",
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

export interface GraphSourceVersionRelation {
  sourceObjectId: string;
  targetSourceObjectId: string;
  sourceSystem: string;
  sourceNativeId: string;
  reason: string;
  orderKnown: boolean;
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
  extractionMethod?: "deterministic" | "qvac";
  extractorVersion?: string;
  evidenceQuote?: string;
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

export interface GraphObservationEvidence {
  claimLogicalId: string;
  observationLogicalId: string;
  sourceLogicalId: string;
  predicate: string;
  object:
    | { kind: "literal"; value: string | number | boolean }
    | { kind: "entity"; entityId: string };
  method: string;
  extractorVersion: string;
  evidenceQuote: string;
  sourceSystem: string;
  sourceNativeId: string;
}

export interface GraphConflictDecision {
  conflictId: string;
  resolution: string;
  claimIds: string[];
  leftClaimId?: string;
  rightClaimId?: string;
  policyId?: string;
  winningClaimId?: string;
}

export interface GraphAlignmentDecision {
  decisionId: string;
  status: string;
  sourceTermId: string;
  ontologyTermId: string;
  ontologyTermName: string;
  relationship: "MAPS_TO" | "REJECTED_MAPPING";
  reason: string;
  evidenceObservationIds?: string[];
  constraints?: string[];
  policyId?: string;
  policyVersion?: string;
  inputDigest?: string;
}

export interface GraphIdentityDecision {
  decisionId: string;
  status: string;
  sourceObjectIds: string[];
  signalKinds: string[];
  constraintKinds: string[];
  algorithmVersion?: string;
  inputDigest?: string;
  supersedesDecisionId?: string;
}

interface HydraValue {
  type: string;
  value: unknown;
}

interface HydraResponse {
  query_id: string;
  columns: string[];
  rows: HydraValue[][];
  read_epoch: number | null;
  bookmark: string | null;
}

export interface HydraQueryResult {
  queryId: string;
  readEpoch: number | null;
  bookmark: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  latencyMs: number;
  roundTrips: 1;
}

export interface NativePathInput {
  sourceLogicalId: string;
  targetLogicalId: string;
  relationshipTypes: GraphRelationshipType[];
  maxLength: number;
  pathCount: number;
}

export interface ExactPathInput {
  nodeLogicalIds: string[];
  relationshipTypes: GraphRelationshipType[];
}

export interface HydraPathProof {
  operation: "algo.SPpaths" | "algo.SPpaths.sequence";
  consistency: "strong";
  queryId: string;
  queryIds?: string[];
  readEpoch: number | null;
  bookmark: string | null;
  latencyMs: number;
  roundTrips: number;
  pathLength: number;
  pathWeight: number;
  pathCost: number;
  nodes: Array<{ id: number; labels: string[]; logicalId: string | null }>;
  relationships: Array<{
    id: number;
    type: string;
    sourceId: number;
    targetId: number;
    logicalId: string | null;
  }>;
}

export interface NativeMultiPathInput {
  sourceLabel: GraphLabel;
  sourceLogicalIds: string[];
  targetLabel: GraphLabel;
  targetLogicalIds: string[];
  relationshipTypes: GraphRelationshipType[];
  maxLength: number;
  pathCount: number;
}

export interface HydraMultiPathResult {
  operation: "algo.MSpaths";
  consistency: "strong";
  queryId: string;
  readEpoch: number | null;
  bookmark: string | null;
  latencyMs: number;
  roundTrips: 1;
  pairCount: number;
  pathCount: number;
  paths: HydraPathProof[];
}

export interface ClientPathBaseline {
  found: boolean;
  latencyMs: number;
  roundTrips: number;
  queryIds: string[];
  pathLogicalIds: string[];
}

export interface ResolvedSourceEntity {
  sourceLogicalId: string;
  entityLogicalId: string;
}

type HydraConsistency = "causal" | "strong";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`HydraDB native path has invalid ${field}`);
  }
  return value;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`HydraDB native path has invalid ${field}`);
  }
  return value;
}

function logicalIdFromProperties(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const logicalId = value.logical_id;
  if (typeof logicalId === "string") return logicalId;
  if (isRecord(logicalId) && typeof logicalId.String === "string") {
    return logicalId.String;
  }
  return null;
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

export function hydraQueryId(
  cypher: string,
  parameters: Record<string, unknown>,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ cypher, parameters }))
    .digest("hex")
    .slice(0, 32);
  return `sourcetruce-${digest}`;
}

export function hydraRequestQueryId(
  cypher: string,
  parameters: Record<string, unknown>,
): string {
  return /^\s*UNWIND\b/i.test(cypher)
    ? hydraQueryId(cypher, parameters)
    : `sourcetruce-read-${randomUUID()}`;
}

export class HydraRepository {
  private readonly queryUrl: string;

  constructor(private readonly config: HydraConfig) {
    this.queryUrl = `${config.httpUrl.replace(/\/$/, "")}/v1/graphs/${encodeURIComponent(config.graphId)}/query`;
  }

  async close(): Promise<void> {}

  private async request(
    cypher: string,
    parameters: Record<string, unknown> = {},
    consistency: HydraConsistency = "causal",
  ): Promise<HydraQueryResult> {
    const startedAt = performance.now();
    const response = await fetch(this.queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        "X-Graph-Namespace": this.config.namespace,
      },
      body: JSON.stringify({
        cell_id: this.config.cellId,
        query_id: hydraRequestQueryId(cypher, parameters),
        query: cypher,
        parameters,
        consistency,
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HydraDB query failed (${response.status}): ${body}`);
    }
    const result = JSON.parse(body) as HydraResponse;
    if (
      typeof result.query_id !== "string" ||
      !Array.isArray(result.columns) ||
      !Array.isArray(result.rows)
    ) {
      throw new TypeError("HydraDB returned a malformed query envelope");
    }
    const rows = result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, index) => [column, row[index]?.value]),
      ),
    );
    return {
      queryId: result.query_id,
      readEpoch:
        typeof result.read_epoch === "number" ? result.read_epoch : null,
      bookmark: typeof result.bookmark === "string" ? result.bookmark : null,
      columns: [...result.columns],
      rows,
      latencyMs: performance.now() - startedAt,
      roundTrips: 1,
    };
  }

  private async query(
    cypher: string,
    parameters: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>[]> {
    return (await this.request(cypher, parameters)).rows;
  }

  async findNativePaths(input: NativePathInput): Promise<HydraPathProof[]> {
    if (!input.sourceLogicalId || !input.targetLogicalId) {
      throw new TypeError("Native path endpoints must be non-empty logical IDs");
    }
    if (
      !Number.isInteger(input.maxLength) ||
      input.maxLength < 1 ||
      input.maxLength > 16
    ) {
      throw new TypeError("Native path maxLength must be between 1 and 16");
    }
    if (
      !Number.isInteger(input.pathCount) ||
      input.pathCount < 1 ||
      input.pathCount > 100
    ) {
      throw new TypeError("Native path pathCount must be between 1 and 100");
    }
    const allowedTypes = [...new Set(input.relationshipTypes)];
    if (
      allowedTypes.length === 0 ||
      allowedTypes.some(
        (type) => !relationshipTypes.includes(type as GraphRelationshipType),
      )
    ) {
      throw new TypeError("Native path relationshipTypes must be supported");
    }

    const relationshipLiteral = allowedTypes
      .map((type) => `'${type}'`)
      .join(", ");
    const result = await this.request(
      `CALL algo.SPpaths({sourceNode: $source, targetNode: $target, relTypes: [${relationshipLiteral}], maxLen: $maxLength, relDirection: 'outgoing', pathCount: $pathCount}) YIELD path, pathWeight, pathCost RETURN path, pathWeight, pathCost`,
      {
        source: hydraIntId(input.sourceLogicalId),
        target: hydraIntId(input.targetLogicalId),
        maxLength: input.maxLength,
        pathCount: input.pathCount,
      },
      "strong",
    );

    return result.rows.map((row) => this.parseNativePath(row, result, input));
  }

  async findExactPath(input: ExactPathInput): Promise<HydraPathProof[]> {
    if (
      input.nodeLogicalIds.length < 2 ||
      input.nodeLogicalIds.length !== input.relationshipTypes.length + 1 ||
      input.nodeLogicalIds.some((logicalId) => !logicalId) ||
      input.relationshipTypes.some((type) => !relationshipTypes.includes(type))
    ) {
      throw new TypeError("Exact path must contain one supported relationship between every non-empty node ID");
    }
    const segments = await Promise.all(input.relationshipTypes.map(async (relationshipType, index) => {
      const paths = await this.findNativePaths({
        sourceLogicalId: input.nodeLogicalIds[index]!,
        targetLogicalId: input.nodeLogicalIds[index + 1]!,
        relationshipTypes: [relationshipType],
        maxLength: 1,
        pathCount: 1,
      });
      if (paths.length !== 1 || paths[0]?.relationships[0]?.type !== relationshipType) {
        throw new TypeError("HydraDB exact path segment is missing or ambiguous");
      }
      return paths[0];
    }));
    const first = segments[0]!;
    const last = segments.at(-1)!;
    const allEpochsPresent = segments.every((segment) => segment.readEpoch !== null);
    const latest = allEpochsPresent
      ? segments.reduce((current, segment) =>
          segment.readEpoch! > current.readEpoch! ? segment : current,
        )
      : last;
    return [{
      operation: "algo.SPpaths.sequence",
      consistency: "strong",
      queryId: first.queryId,
      queryIds: segments.map((segment) => segment.queryId),
      readEpoch: allEpochsPresent ? latest.readEpoch : null,
      bookmark: latest.bookmark,
      latencyMs: Math.max(...segments.map((segment) => segment.latencyMs)),
      roundTrips: segments.length,
      pathLength: input.relationshipTypes.length,
      pathWeight: segments.reduce((total, segment) => total + segment.pathWeight, 0),
      pathCost: segments.reduce((total, segment) => total + segment.pathCost, 0),
      nodes: [first.nodes[0]!, ...segments.map((segment) => segment.nodes[1]!)],
      relationships: segments.map((segment) => segment.relationships[0]!),
    }];
  }

  async findNativeMultiPaths(
    input: NativeMultiPathInput,
  ): Promise<HydraMultiPathResult> {
    if (
      !labels.includes(input.sourceLabel) ||
      !labels.includes(input.targetLabel) ||
      input.sourceLogicalIds.length < 2 ||
      input.sourceLogicalIds.length !== input.targetLogicalIds.length ||
      new Set(input.sourceLogicalIds).size !== input.sourceLogicalIds.length ||
      new Set(input.targetLogicalIds).size !== input.targetLogicalIds.length ||
      input.sourceLogicalIds.some((id) => !id) ||
      input.targetLogicalIds.some((id) => !id)
    ) {
      throw new TypeError("Native multi-path selectors must contain matching unique pairs");
    }
    if (
      !Number.isInteger(input.maxLength) ||
      input.maxLength < 1 ||
      input.maxLength > 16 ||
      !Number.isInteger(input.pathCount) ||
      input.pathCount < 1 ||
      input.pathCount > 100
    ) {
      throw new TypeError("Native multi-path bounds are invalid");
    }
    const allowedTypes = [...new Set(input.relationshipTypes)];
    if (
      allowedTypes.length === 0 ||
      allowedTypes.some((type) => !relationshipTypes.includes(type))
    ) {
      throw new TypeError("Native multi-path relationshipTypes must be supported");
    }
    const relationshipLiteral = allowedTypes.map((type) => `'${type}'`).join(", ");
    const selectorLiteral = (value: string): string => {
      if (!/^[A-Za-z0-9_.:\/-]+$/.test(value)) {
        throw new TypeError("Native multi-path logical IDs contain unsafe selector characters");
      }
      return `'${value}'`;
    };
    const sourceSelectors = input.sourceLogicalIds
      .map(selectorLiteral)
      .join(", ");
    const targetSelectors = input.targetLogicalIds
      .map(selectorLiteral)
      .join(", ");
    const result = await this.request(
      `CALL algo.MSpaths({sourceLabel: '${input.sourceLabel}', sourceProperty: 'logical_id', sourceValues: [${sourceSelectors}], targetLabel: '${input.targetLabel}', targetProperty: 'logical_id', targetValues: [${targetSelectors}], pairwise: false, relTypes: [${relationshipLiteral}], maxLen: $maxLength, relDirection: 'outgoing', pathCount: $pathCount, resultLimit: $resultLimit}) YIELD path, pathWeight, pathCost RETURN path, pathWeight, pathCost`,
      {
        maxLength: input.maxLength,
        pathCount: input.pathCount,
        resultLimit: input.sourceLogicalIds.length * input.pathCount,
      },
      "strong",
    );
    const pairs = new Map(
      input.sourceLogicalIds.map((source, index) => [source, input.targetLogicalIds[index]!]),
    );
    const paths = result.rows.map((row) => {
      if (!isRecord(row.path) || !Array.isArray(row.path.nodes)) {
        throw new TypeError("HydraDB native multi-path result is malformed");
      }
      const rawNodes = row.path.nodes;
      const first = rawNodes[0];
      const last = rawNodes[rawNodes.length - 1];
      const source = isRecord(first) ? logicalIdFromProperties(first.properties) : null;
      const target = isRecord(last) ? logicalIdFromProperties(last.properties) : null;
      if (!source || !target || pairs.get(source) !== target) {
        throw new TypeError("HydraDB native multi-path endpoints do not match indexed pairs");
      }
      return this.parseNativePath(row, result, {
        sourceLogicalId: source,
        targetLogicalId: target,
        relationshipTypes: allowedTypes,
        maxLength: input.maxLength,
        pathCount: input.pathCount,
      });
    });
    const returnedPairs = new Set(
      paths.map((path) =>
        `${path.nodes[0]?.logicalId ?? ""}\u0000${path.nodes[path.nodes.length - 1]?.logicalId ?? ""}`,
      ),
    );
    const expectedPairs = input.sourceLogicalIds.map(
      (source, index) => `${source}\u0000${input.targetLogicalIds[index]!}`,
    );
    if (expectedPairs.some((pair) => !returnedPairs.has(pair))) {
      throw new TypeError("HydraDB native multi-path omitted an indexed endpoint pair");
    }
    return {
      operation: "algo.MSpaths",
      consistency: "strong",
      queryId: result.queryId,
      readEpoch: result.readEpoch,
      bookmark: result.bookmark,
      latencyMs: result.latencyMs,
      roundTrips: 1,
      pairCount: input.sourceLogicalIds.length,
      pathCount: paths.length,
      paths,
    };
  }

  async findClientPathBaseline(input: NativePathInput): Promise<ClientPathBaseline> {
    if (
      !input.sourceLogicalId ||
      !input.targetLogicalId ||
      input.sourceLogicalId === input.targetLogicalId ||
      !Number.isInteger(input.maxLength) ||
      input.maxLength < 1 ||
      input.maxLength > 16
    ) {
      throw new TypeError("Client path baseline endpoints or bounds are invalid");
    }
    const allowedTypes = [...new Set(input.relationshipTypes)];
    if (
      allowedTypes.length === 0 ||
      allowedTypes.some((type) => !relationshipTypes.includes(type))
    ) {
      throw new TypeError("Client path baseline relationshipTypes must be supported");
    }
    const started = performance.now();
    const queryIds: string[] = [];
    const visited = new Set([input.sourceLogicalId]);
    let frontier = [{ logicalId: input.sourceLogicalId, path: [input.sourceLogicalId] }];
    for (let depth = 0; depth < input.maxLength; depth += 1) {
      const next: typeof frontier = [];
      for (const current of frontier) {
        for (const type of allowedTypes) {
          const result = await this.request(
            `MATCH (a {id: $source})-[r:${type}]->(b) RETURN b.logical_id AS targetLogicalId`,
            { source: hydraIntId(current.logicalId) },
            "strong",
          );
          queryIds.push(result.queryId);
          for (const row of result.rows) {
            const target = row.targetLogicalId;
            if (typeof target !== "string" || !target) {
              throw new TypeError("HydraDB client baseline returned an invalid target");
            }
            const path = [...current.path, target];
            if (target === input.targetLogicalId) {
              return {
                found: true,
                latencyMs: performance.now() - started,
                roundTrips: queryIds.length,
                queryIds,
                pathLogicalIds: path,
              };
            }
            if (!visited.has(target)) {
              visited.add(target);
              next.push({ logicalId: target, path });
            }
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return {
      found: false,
      latencyMs: performance.now() - started,
      roundTrips: queryIds.length,
      queryIds,
      pathLogicalIds: [],
    };
  }

  async findResolvedEntitiesForSources(
    sourceLogicalIds: string[],
  ): Promise<ResolvedSourceEntity[]> {
    const sources = [...new Set(sourceLogicalIds)].sort();
    if (sources.length === 0 || sources.some((logicalId) => !logicalId)) {
      throw new TypeError("Resolved-entity source IDs must be non-empty");
    }
    const result: ResolvedSourceEntity[] = [];
    for (const sourceLogicalId of sources) {
      const rows = await this.query(
        "MATCH (s {id: $source})-[:RESOLVES_TO]->(e) RETURN e.logical_id AS entityLogicalId",
        { source: hydraIntId(sourceLogicalId) },
      );
      if (rows.length !== 1 || typeof rows[0]?.entityLogicalId !== "string") {
        throw new TypeError("HydraDB returned an invalid source/entity resolution");
      }
      result.push({ sourceLogicalId, entityLogicalId: rows[0].entityLogicalId });
    }
    return result.sort(
      (left, right) =>
        left.sourceLogicalId.localeCompare(right.sourceLogicalId) ||
        left.entityLogicalId.localeCompare(right.entityLogicalId),
    );
  }

  private parseNativePath(
    row: Record<string, unknown>,
    result: HydraQueryResult,
    input: NativePathInput,
  ): HydraPathProof {
    if (!isRecord(row.path)) {
      throw new TypeError("HydraDB native path result is missing path data");
    }
    const rawNodes = row.path.nodes;
    const rawRelationships = row.path.relationships;
    if (!Array.isArray(rawNodes) || !Array.isArray(rawRelationships)) {
      throw new TypeError("HydraDB native path topology is malformed");
    }
    if (
      rawNodes.length < 2 ||
      rawNodes.length !== rawRelationships.length + 1 ||
      rawRelationships.length > input.maxLength
    ) {
      throw new TypeError("HydraDB native path topology is malformed");
    }

    const nodes = rawNodes.map((rawNode) => {
      if (!isRecord(rawNode) || !Array.isArray(rawNode.labels)) {
        throw new TypeError("HydraDB native path node is malformed");
      }
      const labels = rawNode.labels;
      if (labels.some((label) => typeof label !== "string")) {
        throw new TypeError("HydraDB native path node labels are malformed");
      }
      return {
        id: requiredSafeInteger(rawNode.id, "node ID"),
        labels: labels as string[],
        logicalId: logicalIdFromProperties(rawNode.properties),
      };
    });

    const allowedTypes = new Set<string>(input.relationshipTypes);
    const relationships = rawRelationships.map((rawRelationship, index) => {
      if (!isRecord(rawRelationship)) {
        throw new TypeError("HydraDB native path relationship is malformed");
      }
      const type = rawRelationship.edge_type;
      if (typeof type !== "string" || !allowedTypes.has(type)) {
        throw new TypeError(
          "HydraDB native path contains a disallowed relationship type",
        );
      }
      const sourceId = requiredSafeInteger(
        rawRelationship.src,
        "relationship source ID",
      );
      const targetId = requiredSafeInteger(
        rawRelationship.dst,
        "relationship target ID",
      );
      if (sourceId !== nodes[index]?.id || targetId !== nodes[index + 1]?.id) {
        throw new TypeError("HydraDB native path relationship is not contiguous");
      }
      return {
        id: requiredSafeInteger(rawRelationship.id, "relationship ID"),
        type,
        sourceId,
        targetId,
        logicalId: logicalIdFromProperties(rawRelationship.properties),
      };
    });

    const expectedSourceId = hydraIntId(input.sourceLogicalId);
    const expectedTargetId = hydraIntId(input.targetLogicalId);
    if (
      nodes[0]?.id !== expectedSourceId ||
      nodes[nodes.length - 1]?.id !== expectedTargetId ||
      (nodes[0]?.logicalId !== null &&
        nodes[0]?.logicalId !== input.sourceLogicalId) ||
      (nodes[nodes.length - 1]?.logicalId !== null &&
        nodes[nodes.length - 1]?.logicalId !== input.targetLogicalId)
    ) {
      throw new TypeError("HydraDB native path endpoints do not match request");
    }

    return {
      operation: "algo.SPpaths",
      consistency: "strong",
      queryId: result.queryId,
      readEpoch: result.readEpoch,
      bookmark: result.bookmark,
      latencyMs: result.latencyMs,
      roundTrips: 1,
      pathLength: relationships.length,
      pathWeight: requiredFiniteNumber(row.pathWeight, "path weight"),
      pathCost: requiredFiniteNumber(row.pathCost, "path cost"),
      nodes,
      relationships,
    };
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

    const conflictNodes = bundle.nodes.filter((node) => node.label === "Conflict");
    const decisionTargetByConflict = new Map(
      bundle.edges
        .filter((edge) => edge.type === "DECIDED_BY" && edge.sourceLabel === "Conflict")
        .map((edge) => [edge.sourceLogicalId, edge.targetLogicalId]),
    );
    const conflictRows = conflictNodes.map((node) => ({
      sourceId: hydraIntId(node.logicalId),
      targetId: decisionTargetByConflict.has(node.logicalId)
        ? hydraIntId(decisionTargetByConflict.get(node.logicalId)!)
        : null,
    }));
    for (const row of conflictRows) {
      let existing: Record<string, unknown>[];
      try {
        existing = await this.query(
          "MATCH (f:Conflict {id: $sourceId})-[:DECIDED_BY]->(p:AuthorityPolicy) RETURN p.id AS targetId",
          { sourceId: row.sourceId },
        );
      } catch (error) {
        throw new Error(`HydraDB exclusive policy read failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const stale = existing
        .filter(
          (existingRow) =>
            row.targetId === null ||
            String(row.targetId) !== String(existingRow.targetId),
        )
        .map((existingRow) => existingRow.targetId);
      for (const targetId of stale) {
        try {
          await this.query(
            "MATCH (f {id: $sourceId})-[r:DECIDED_BY]->(p {id: $targetId}) DELETE r",
            { sourceId: row.sourceId, targetId },
          );
        } catch (error) {
          throw new Error(`HydraDB stale policy delete failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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
        const parameters = type === "DECIDED_BY"
          ? {
              rows: chunk,
              reconciliationAttempt: randomUUID(),
            }
          : { rows: chunk };
        await this.query(
          `UNWIND $rows AS row MATCH (a:${sourceLabel} {id: row.sourceId}), (b:${targetLabel} {id: row.targetId}) MERGE (a)-[r:${type} {id: row.id}]->(b) SET r.logical_id = row.logicalId, r.payload_json = row.payloadJson`,
          parameters,
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
          ...(claimPayload.extractionMethod === "deterministic" ||
          claimPayload.extractionMethod === "qvac"
            ? { extractionMethod: claimPayload.extractionMethod }
            : {}),
          ...(typeof claimPayload.extractorVersion === "string"
            ? { extractorVersion: claimPayload.extractorVersion }
            : {}),
          ...(typeof claimPayload.evidenceQuote === "string"
            ? { evidenceQuote: claimPayload.evidenceQuote }
            : {}),
        },
      ];
    });
  }

  async findObservationEvidence(
    entityLogicalId: string,
  ): Promise<GraphObservationEvidence[]> {
    const rows = await this.query(
      "MATCH (e:Entity {id: $entityId})-[:ASSERTS]->(c:Claim)-[:HAS_OBSERVATION]->(o:ExtractionObservation)-[:SUPPORTED_BY]->(s:SourceObject) RETURN c.logical_id AS claim, c.payload_json AS claimPayload, o.logical_id AS observation, o.payload_json AS observationPayload, s.logical_id AS source, s.payload_json AS sourcePayload",
      { entityId: hydraIntId(entityLogicalId) },
    );
    return rows
      .map((row): GraphObservationEvidence => {
        const claimPayload = JSON.parse(String(row.claimPayload)) as Record<
          string,
          unknown
        >;
        const observationPayload = JSON.parse(
          String(row.observationPayload),
        ) as Record<string, unknown>;
        const sourcePayload = JSON.parse(String(row.sourcePayload)) as Record<
          string,
          unknown
        >;
        return {
          claimLogicalId: String(row.claim),
          observationLogicalId: String(row.observation),
          sourceLogicalId: String(row.source),
          predicate: String(claimPayload.predicate),
          object: JSON.parse(String(claimPayload.objectJson)) as GraphObservationEvidence["object"],
          method: String(observationPayload.method),
          extractorVersion: String(observationPayload.extractorVersion),
          evidenceQuote: String(observationPayload.evidenceQuote),
          sourceSystem: String(sourcePayload.sourceSystem),
          sourceNativeId: String(sourcePayload.nativeId),
        };
      })
      .sort((left, right) =>
        left.observationLogicalId.localeCompare(right.observationLogicalId),
      );
  }

  async findConflictDecision(
    conflictLogicalId: string,
  ): Promise<GraphConflictDecision | null> {
    const conflictId = hydraIntId(conflictLogicalId);
    const [claimRows, policyRows] = await Promise.all([
      this.query(
        "MATCH (f:Conflict {id: $conflictId})-[r:CONSIDERS]->(c:Claim) RETURN f.logical_id AS conflict, f.payload_json AS conflictPayload, c.logical_id AS claim, r.payload_json AS edgePayload",
        { conflictId },
      ),
      this.query(
        "MATCH (f:Conflict {id: $conflictId})-[:DECIDED_BY]->(p:AuthorityPolicy) RETURN p.logical_id AS policy",
        { conflictId },
      ),
    ]);
    if (claimRows.length === 0) return null;
    const payload = JSON.parse(String(claimRows[0].conflictPayload)) as Record<
      string,
      unknown
    >;
    const resolution = String(payload.resolution ?? "unresolved");
    const winningRow = claimRows.find((row) => {
      const edgePayload = JSON.parse(String(row.edgePayload ?? "{}")) as Record<string, unknown>;
      return edgePayload.side === resolution;
    });
    const claimForSide = (side: "left" | "right") => {
      const row = claimRows.find((candidate) => {
        const edgePayload = JSON.parse(String(candidate.edgePayload ?? "{}")) as Record<string, unknown>;
        return edgePayload.side === side;
      });
      return row ? String(row.claim) : undefined;
    };
    return {
      conflictId: String(claimRows[0].conflict),
      resolution,
      claimIds: [...new Set(claimRows.map((row) => String(row.claim)))].sort(),
      leftClaimId: claimForSide("left"),
      rightClaimId: claimForSide("right"),
      policyId: policyRows[0]?.policy
        ? String(policyRows[0].policy)
        : undefined,
      winningClaimId: winningRow ? String(winningRow.claim) : undefined,
    };
  }

  async findAlignmentDecisions(
    sourceTermLogicalId: string,
  ): Promise<GraphAlignmentDecision[]> {
    const sourceTermId = hydraIntId(sourceTermLogicalId);
    const [acceptedRows, decisionRows, metadataRows] = await Promise.all([
      this.query(
        "MATCH (s:SourceSchemaTerm {id: $sourceTermId})-[r:MAPS_TO]->(o:OntologyTerm) RETURN r.payload_json AS edgePayload, o.logical_id AS ontology, o.payload_json AS ontologyPayload",
        { sourceTermId },
      ),
      this.query(
        "MATCH (d:AlignmentDecision)-[r:REJECTED_MAPPING]->(o:OntologyTerm) RETURN d.logical_id AS decision, d.payload_json AS decisionPayload, o.logical_id AS ontology, o.payload_json AS ontologyPayload",
      ),
      this.query(
        "MATCH (d:AlignmentDecision)-[:CONSIDERS]->(s:SourceSchemaTerm) RETURN d.logical_id AS decision, d.payload_json AS decisionPayload, s.logical_id AS sourceTerm",
      ),
    ]);
    const metadata = new Map(metadataRows.map((row) => [String(row.decision), JSON.parse(String(row.decisionPayload)) as Record<string, unknown>]));
    const provenance = (decisionId: string) => {
      const payload = metadata.get(decisionId) ?? {};
      return {
        evidenceObservationIds: JSON.parse(String(payload.evidenceObservationIdsJson ?? "[]")) as string[],
        constraints: JSON.parse(String(payload.constraintsJson ?? "[]")) as string[],
        policyId: payload.policyId ? String(payload.policyId) : undefined,
        policyVersion: payload.policyVersion ? String(payload.policyVersion) : undefined,
        inputDigest: payload.inputDigest ? String(payload.inputDigest) : undefined,
      };
    };
    const accepted = acceptedRows.map((row): GraphAlignmentDecision => {
      const edgePayload = JSON.parse(String(row.edgePayload)) as Record<string, unknown>;
      const ontologyPayload = JSON.parse(String(row.ontologyPayload)) as Record<string, unknown>;
      const decisionId = String(edgePayload.decisionId);
      return {
        decisionId,
        status: "accepted",
        sourceTermId: sourceTermLogicalId,
        ontologyTermId: String(row.ontology),
        ontologyTermName: String(ontologyPayload.name),
        relationship: "MAPS_TO",
        reason: "exact_registry_rule",
        ...provenance(decisionId),
      };
    });
    const rejected = decisionRows.flatMap((row): GraphAlignmentDecision[] => {
      const payload = JSON.parse(String(row.decisionPayload)) as Record<string, unknown>;
      const ontologyPayload = JSON.parse(String(row.ontologyPayload)) as Record<string, unknown>;
      if (payload.sourceTermId !== sourceTermLogicalId) return [];
      return [{
        decisionId: String(row.decision),
        status: String(payload.status),
        sourceTermId: sourceTermLogicalId,
        ontologyTermId: String(row.ontology),
        ontologyTermName: String(ontologyPayload.name),
        relationship: "REJECTED_MAPPING",
        reason: String(payload.reason),
        ...provenance(String(row.decision)),
      }];
    });
    return [...accepted, ...rejected].sort((left, right) =>
      left.decisionId.localeCompare(right.decisionId),
    );
  }

  async findIdentityDecision(
    decisionLogicalId: string,
  ): Promise<GraphIdentityDecision | null> {
    const decisionId = hydraIntId(decisionLogicalId);
    const [sourceRows, signalRows, constraintRows, supersedesRows] = await Promise.all([
      this.query(
        "MATCH (d:ResolutionDecision {id: $decisionId})-[:CONSIDERS]->(s:SourceObject) RETURN d.logical_id AS decision, d.payload_json AS payload, s.logical_id AS source",
        { decisionId },
      ),
      this.query(
        "MATCH (d:ResolutionDecision {id: $decisionId})-[:SUPPORTED_BY]->(s:ResolutionSignal) RETURN s.payload_json AS payload",
        { decisionId },
      ),
      this.query(
        "MATCH (d:ResolutionDecision {id: $decisionId})-[:BLOCKED_BY]->(c:ResolutionConstraint) RETURN c.payload_json AS payload",
        { decisionId },
      ),
      this.query(
        "MATCH (d:ResolutionDecision {id: $decisionId})-[:SUPERSEDES]->(p:ResolutionDecision) RETURN p.logical_id AS supersedesDecisionId",
        { decisionId },
      ),
    ]);
    if (sourceRows.length === 0) return null;
    const decisionPayload = JSON.parse(String(sourceRows[0].payload)) as Record<string, unknown>;
    return {
      decisionId: String(sourceRows[0].decision),
      status: String(decisionPayload.status),
      sourceObjectIds: sourceRows.map((row) => String(row.source)).sort(),
      signalKinds: signalRows.map((row) => String((JSON.parse(String(row.payload)) as Record<string, unknown>).kind)).sort(),
      constraintKinds: constraintRows.map((row) => String((JSON.parse(String(row.payload)) as Record<string, unknown>).kind)).sort(),
      ...(typeof decisionPayload.algorithmVersion === "string"
        ? { algorithmVersion: decisionPayload.algorithmVersion }
        : {}),
      ...(typeof decisionPayload.inputDigest === "string"
        ? { inputDigest: decisionPayload.inputDigest }
        : {}),
      ...(typeof supersedesRows[0]?.supersedesDecisionId === "string"
        ? { supersedesDecisionId: supersedesRows[0].supersedesDecisionId }
        : {}),
    };
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

  async findSourceVersionRelations(
    sourceSystem: string,
    sourceNativeId: string,
  ): Promise<GraphSourceVersionRelation[]> {
    const rows = await this.query(
      "MATCH (a:SourceObject)-[r:VERSION_OF]->(b:SourceObject) RETURN a.logical_id AS source, a.payload_json AS sourcePayload, r.payload_json AS relationPayload, b.logical_id AS target, b.payload_json AS targetPayload",
    );
    return rows.flatMap((row): GraphSourceVersionRelation[] => {
      const sourcePayload = JSON.parse(String(row.sourcePayload)) as Record<string, unknown>;
      const targetPayload = JSON.parse(String(row.targetPayload)) as Record<string, unknown>;
      const relationPayload = JSON.parse(String(row.relationPayload ?? "{}")) as Record<string, unknown>;
      if (
        sourcePayload.sourceSystem !== sourceSystem ||
        sourcePayload.nativeId !== sourceNativeId ||
        targetPayload.sourceSystem !== sourceSystem ||
        targetPayload.nativeId !== sourceNativeId
      ) {
        return [];
      }
      return [{
        sourceObjectId: String(row.source),
        targetSourceObjectId: String(row.target),
        sourceSystem,
        sourceNativeId,
        reason: String(relationPayload.reason ?? ""),
        orderKnown: relationPayload.orderKnown === true,
      }];
    }).sort((left, right) =>
      left.sourceObjectId.localeCompare(right.sourceObjectId),
    );
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
