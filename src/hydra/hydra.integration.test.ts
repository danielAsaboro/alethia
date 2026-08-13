import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HydraRepository,
  type GraphWriteBundle,
} from "./client";

const runIntegration = process.env.HYDRA_INTEGRATION === "1";

describe.runIf(runIntegration)("HydraRepository against HydraDB OSS", () => {
  let repository: HydraRepository;
  const bundle: GraphWriteBundle = {
    nodes: [
      {
        logicalId: "entity_integration_evidence",
        label: "Entity",
        properties: { kind: "person", name: "Integration Evidence" },
      },
      {
        logicalId: "claim_integration_evidence",
        label: "Claim",
        properties: { predicate: "has_status", value: "verified" },
      },
      {
        logicalId: "source_integration_evidence",
        label: "SourceObject",
        properties: { sourceSystem: "integration", nativeId: "real-1" },
      },
    ],
    edges: [
      {
        logicalId: "edge_integration_asserts",
        type: "ASSERTS",
        sourceLabel: "Entity",
        sourceLogicalId: "entity_integration_evidence",
        targetLabel: "Claim",
        targetLogicalId: "claim_integration_evidence",
        properties: {},
      },
      {
        logicalId: "edge_integration_supported",
        type: "SUPPORTED_BY",
        sourceLabel: "Claim",
        sourceLogicalId: "claim_integration_evidence",
        targetLabel: "SourceObject",
        targetLogicalId: "source_integration_evidence",
        properties: {},
      },
    ],
  };

  beforeAll(() => {
    repository = new HydraRepository({
      httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
      token:
        process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
      graphId: process.env.HYDRA_GRAPH_ID ?? "default",
      namespace: process.env.HYDRA_NAMESPACE ?? "default",
      cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
    });
  });

  afterAll(async () => {
    await repository.close();
  });

  it("round-trips an idempotent evidence path through the real graph node", async () => {
    await repository.writeGraph(bundle);
    await repository.writeGraph(bundle);

    const presence = await repository.getPresence(bundle);
    expect(presence).toEqual({ nodes: 3, edges: 2 });
    expect(
      await repository.findEvidencePath("entity_integration_evidence"),
    ).toEqual([
      "entity_integration_evidence",
      "claim_integration_evidence",
      "source_integration_evidence",
    ]);
  });
});
