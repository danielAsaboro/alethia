import { describe, expect, it, vi } from "vitest";

import type { GraphWriteBundle } from "@/hydra/client";
import {
  parseVerifyResilienceArgs,
  probeQvacExtractionOutage,
  verifyResilience,
} from "./verify-resilience";

const graph: GraphWriteBundle = {
  nodes: [
    { logicalId: "entity", label: "Entity" as const, properties: { name: "Real" } },
    { logicalId: "claim", label: "Claim" as const, properties: { predicate: "role" } },
    { logicalId: "source", label: "SourceObject" as const, properties: { sourceSystem: "herb" } },
  ],
  edges: [
    { logicalId: "asserts", type: "ASSERTS" as const, sourceLabel: "Entity" as const, sourceLogicalId: "entity", targetLabel: "Claim" as const, targetLogicalId: "claim", properties: {} },
    { logicalId: "supports", type: "SUPPORTED_BY" as const, sourceLabel: "Claim" as const, sourceLogicalId: "claim", targetLabel: "SourceObject" as const, targetLogicalId: "source", properties: {} },
  ],
};

describe("parseVerifyResilienceArgs", () => {
  it("requires real HERB input and ignored output paths", () => {
    expect(parseVerifyResilienceArgs(["--herb-input", "HERB", "--output", ".local/resilience.json"])).toEqual({ herbInput: "HERB", output: ".local/resilience.json" });
    expect(() => parseVerifyResilienceArgs([])).toThrow(/Usage:/);
  });
});

describe("probeQvacExtractionOutage", () => {
  it("uses the real extraction-client contract with canonical source metadata", async () => {
    const extractClaims = vi.fn().mockRejectedValue(new Error("QVAC unavailable"));

    await expect(probeQvacExtractionOutage({ extractClaims }, {
      id: "source_object_canonical",
      sourceNativeId: "ActionGenie.json",
      sourceSystem: "herb",
      fields: { name: "ActionGenie" },
    })).rejects.toThrow("QVAC unavailable");

    expect(extractClaims).toHaveBeenCalledWith(expect.objectContaining({
      sourceObjectId: "source_object_canonical",
      sourceSystem: "herb",
      sourceText: JSON.stringify({ name: "ActionGenie" }),
      maxClaims: 1,
    }));
  });
});

describe("verifyResilience", () => {
  it("proves idempotency, concurrent IDs, replay, and outage failure without QVAC", async () => {
    let read = 0;
    const repository = {
      writeGraph: vi.fn().mockResolvedValue(undefined),
      getPresence: vi.fn().mockResolvedValue({ nodes: 3, edges: 2 }),
      findNativePaths: vi.fn().mockImplementation(async (input) => input.targetLogicalId.includes("missing") ? [] : [{
        operation: "algo.SPpaths",
        queryId: `read-${read++}`,
        roundTrips: 1,
        pathLength: 2,
      }]),
    };
    const outageRepository = {
      entityExists: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    };
    const runCases = vi.fn().mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({ caseId: `case-${index}`, status: "completed", workspace: { verdict: "SUPPORTED" } })),
    );

    const report = await verifyResilience({ repository, outageRepository, graph, runCases, qvacOutageProbe: vi.fn().mockRejectedValue(new Error("QVAC unavailable")) });

    expect(repository.writeGraph).toHaveBeenCalledTimes(2);
    expect(repository.findNativePaths).toHaveBeenCalledTimes(21);
    expect(report).toMatchObject({
      graph: { nodes: 3, edges: 2, stableAcrossRepeatedWrites: true },
      concurrency: { attempted: 20, completed: 20, uniqueQueryIds: 20, oneRoundTripEach: true },
      replay: { attempted: 8, completed: 8, failed: 0, qvacRequired: false },
      outage: { failedClosed: true, workspaceReturned: false },
    });
    expect(report.probes).toHaveLength(8);
    expect(report.probes.every((probe) => probe.status === "passed")).toBe(true);
    expect(report.graph.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects reused read IDs rather than reporting simulated concurrency", async () => {
    const repository = {
      writeGraph: vi.fn().mockResolvedValue(undefined),
      getPresence: vi.fn().mockResolvedValue({ nodes: 3, edges: 2 }),
      findNativePaths: vi.fn().mockResolvedValue([{ operation: "algo.SPpaths", queryId: "same", roundTrips: 1, pathLength: 2 }]),
    };
    await expect(verifyResilience({
      repository,
      outageRepository: { entityExists: vi.fn().mockRejectedValue(new Error("offline")) },
      graph,
      runCases: vi.fn().mockResolvedValue([]),
      qvacOutageProbe: vi.fn().mockRejectedValue(new Error("QVAC unavailable")),
    })).rejects.toThrow(/unique query IDs/i);
  });
});
