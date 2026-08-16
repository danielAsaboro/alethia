export interface HydraQueryTelemetry {
  operation: string;
  queryId: string;
  queryIds: string[];
  consistencyMode: "causal" | "strong";
  bookmark: string | null;
  readEpoch: number | null;
  nodes: number | null;
  relationships: number | null;
  pathLength: number | null;
  roundTrips: number;
  observedLatencyMs: number;
}

export interface HydraPathTelemetryInput {
  operation: string;
  queryId: string;
  queryIds?: string[];
  consistency: "causal" | "strong";
  bookmark: string | null;
  readEpoch: number | null;
  nodes: unknown[];
  relationships: unknown[];
  pathLength: number;
  roundTrips: number;
  latencyMs: number;
}

export function toHydraQueryTelemetry(input: HydraPathTelemetryInput): HydraQueryTelemetry {
  return {
    operation: input.operation,
    queryId: input.queryId,
    queryIds: input.queryIds ? [...input.queryIds] : [input.queryId],
    consistencyMode: input.consistency,
    bookmark: input.bookmark,
    readEpoch: input.readEpoch,
    nodes: input.nodes.length,
    relationships: input.relationships.length,
    pathLength: input.pathLength,
    roundTrips: input.roundTrips,
    observedLatencyMs: input.latencyMs,
  };
}
