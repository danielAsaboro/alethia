import { createHash } from "node:crypto";

export interface FingerprintNode {
  logicalId: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface FingerprintEdge {
  logicalId: string;
  type: string;
  sourceLogicalId: string;
  targetLogicalId: string;
  properties: Record<string, unknown>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Graph fingerprint cannot encode non-finite numbers");
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("Graph fingerprint contains a non-JSON value");
    }
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
  );
}

function assertUnique(values: Array<{ logicalId: string }>, kind: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.logicalId || seen.has(value.logicalId)) {
      throw new TypeError(`Graph fingerprint contains a missing or duplicate ${kind} ID`);
    }
    seen.add(value.logicalId);
  }
}

export function fingerprintGraph(graph: {
  nodes: FingerprintNode[];
  edges: FingerprintEdge[];
}) {
  assertUnique(graph.nodes, "node");
  assertUnique(graph.edges, "edge");
  const canonical = canonicalize({
    nodes: [...graph.nodes].sort(
      (left, right) =>
        left.logicalId.localeCompare(right.logicalId) ||
        left.label.localeCompare(right.label),
    ),
    edges: [...graph.edges].sort(
      (left, right) =>
        left.logicalId.localeCompare(right.logicalId) ||
        left.type.localeCompare(right.type) ||
        left.sourceLogicalId.localeCompare(right.sourceLogicalId) ||
        left.targetLogicalId.localeCompare(right.targetLogicalId),
    ),
  });
  const body = JSON.stringify(canonical);
  return {
    sha256: createHash("sha256").update(body).digest("hex"),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    canonicalBytes: Buffer.byteLength(body),
  };
}
