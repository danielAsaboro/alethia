import { describe, expect, it, vi } from "vitest";

import { measureHydraLeverage, parseMeasureHydraLeverageArgs } from "./measure-hydra-leverage";

describe("parseMeasureHydraLeverageArgs", () => {
  it("requires one output path", () => {
    expect(parseMeasureHydraLeverageArgs(["--output", ".local/leverage.json"])).toEqual({ output: ".local/leverage.json" });
    expect(() => parseMeasureHydraLeverageArgs([])).toThrow(/Usage:/);
  });
});

describe("measureHydraLeverage", () => {
  it("reports native SP/MS operations against a bounded client fan-out baseline", async () => {
    const repository = {
      findClaimEvidence: vi.fn().mockResolvedValue([{ claimLogicalId: "claim", sourceLogicalId: "source" }]),
      findAlignmentDecisions: vi.fn()
        .mockResolvedValueOnce([{ status: "accepted", sourceTermId: "st1", ontologyTermId: "ot1" }])
        .mockResolvedValueOnce([{ status: "accepted", sourceTermId: "st2", ontologyTermId: "ot2" }]),
      findNativePaths: vi.fn().mockResolvedValue([{ operation: "algo.SPpaths", latencyMs: 8, roundTrips: 1, pathLength: 2 }]),
      findClientPathBaseline: vi.fn().mockResolvedValue({ found: true, latencyMs: 20, roundTrips: 4, pathLogicalIds: ["entity_90ad19476a96ae677e3c9143", "claim", "source"], queryIds: ["q1", "q2", "q3", "q4"] }),
      findNativeMultiPaths: vi.fn().mockResolvedValue({ operation: "algo.MSpaths", latencyMs: 11, roundTrips: 1, pairCount: 2, pathCount: 2, queryId: "qm" }),
    };

    expect(await measureHydraLeverage(repository)).toEqual({
      scope: "local single-host measurement; not a universal speedup claim",
      singlePair: {
        operation: "algo.SPpaths",
        sourceLogicalId: "entity_90ad19476a96ae677e3c9143",
        targetLogicalId: "source",
        pathCount: 1,
        pathLength: 2,
        nativeLatencyMs: 8,
        nativeRoundTrips: 1,
        clientLatencyMs: 20,
        clientRoundTrips: 4,
        avoidedRoundTrips: 3,
        clientToNativeLatencyRatio: 2.5,
      },
      multiplePairs: { operation: "algo.MSpaths", pairCount: 2, pathCount: 2, latencyMs: 11, roundTrips: 1, queryId: "qm" },
    });
  });
});
