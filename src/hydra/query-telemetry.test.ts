import { describe, expect, it } from "vitest";

import { toHydraQueryTelemetry } from "./query-telemetry";

describe("toHydraQueryTelemetry", () => {
  it("retains every server-exposed path field and makes unavailable fields explicit", () => {
    expect(toHydraQueryTelemetry({
      operation: "algo.SPpaths",
      consistency: "strong",
      queryId: "query-1",
      readEpoch: null,
      bookmark: null,
      latencyMs: 12.5,
      roundTrips: 1,
      pathLength: 2,
      nodes: [{}, {}, {}],
      relationships: [{}, {}],
    })).toEqual({
      operation: "algo.SPpaths",
      queryId: "query-1",
      queryIds: ["query-1"],
      consistencyMode: "strong",
      bookmark: null,
      readEpoch: null,
      nodes: 3,
      relationships: 2,
      pathLength: 2,
      roundTrips: 1,
      observedLatencyMs: 12.5,
    });
  });

  it("retains every query ID for composed exact paths", () => {
    const telemetry = toHydraQueryTelemetry({
      operation: "algo.SPpaths.sequence", consistency: "strong", queryId: "q1", queryIds: ["q1", "q2"], readEpoch: 9,
      bookmark: "b", latencyMs: 4, roundTrips: 2, pathLength: 2, nodes: [{}, {}, {}], relationships: [{}, {}],
    });
    expect(telemetry.queryIds).toEqual(["q1", "q2"]);
    expect(telemetry.roundTrips).toBe(2);
  });
});
