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
      {
        logicalId: "run_integration_evidence",
        label: "IngestionRun",
        properties: { sourceSystem: "integration" },
      },
      {
        logicalId: "coverage_integration_evidence",
        label: "CoverageSlice",
        properties: {
          sourceSystem: "integration",
          objectType: "record",
          status: "complete",
          contentScope: "metadata",
          predicateFamiliesJson: JSON.stringify(["has_status"]),
        },
      },
      {
        logicalId: "entity_integration_member",
        label: "Entity",
        properties: { kind: "person" },
      },
      {
        logicalId: "claim_integration_member_name",
        label: "Claim",
        properties: {
          predicate: "display_name",
          objectJson: JSON.stringify({ kind: "literal", value: "Member One" }),
        },
      },
      {
        logicalId: "source_integration_member",
        label: "SourceObject",
        properties: { sourceSystem: "integration", nativeId: "member-1" },
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
        logicalId: "edge_integration_covers",
        type: "COVERS",
        sourceLabel: "IngestionRun",
        sourceLogicalId: "run_integration_evidence",
        targetLabel: "CoverageSlice",
        targetLogicalId: "coverage_integration_evidence",
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
      {
        logicalId: "edge_integration_team_member",
        type: "HAS_TEAM_MEMBER",
        sourceLabel: "Entity",
        sourceLogicalId: "entity_integration_evidence",
        targetLabel: "Entity",
        targetLogicalId: "entity_integration_member",
        properties: { claimId: "claim_integration_team" },
      },
      {
        logicalId: "edge_integration_member_asserts",
        type: "ASSERTS",
        sourceLabel: "Entity",
        sourceLogicalId: "entity_integration_member",
        targetLabel: "Claim",
        targetLogicalId: "claim_integration_member_name",
        properties: {},
      },
      {
        logicalId: "edge_integration_member_supported",
        type: "SUPPORTED_BY",
        sourceLabel: "Claim",
        sourceLogicalId: "claim_integration_member_name",
        targetLabel: "SourceObject",
        targetLogicalId: "source_integration_member",
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
    expect(presence).toEqual({ nodes: 8, edges: 6 });
    expect(
      await repository.findEvidencePath("entity_integration_evidence"),
    ).toEqual([
      "entity_integration_evidence",
      "claim_integration_evidence",
      "source_integration_evidence",
    ]);
    expect(await repository.entityExists("entity_integration_evidence")).toBe(
      true,
    );
    expect(await repository.entityExists("entity_integration_missing")).toBe(
      false,
    );
    expect(
      await repository.findClaimEvidence(
        "entity_integration_evidence",
        "has_status",
      ),
    ).toEqual([
      {
        claimLogicalId: "claim_integration_evidence",
        predicate: "has_status",
        object: { kind: "literal", value: "verified" },
        sourceLogicalId: "source_integration_evidence",
        sourceSystem: "integration",
        sourceNativeId: "real-1",
      },
    ]);
    expect(
      await repository.findCoverageSlices(
        "integration",
        "record",
      ),
    ).toEqual([
      {
        id: "coverage_integration_evidence",
        ingestionRunId: "run_integration_evidence",
        sourceSystem: "integration",
        objectType: "record",
        predicateFamilies: ["has_status"],
        contentScope: "metadata",
        status: "complete",
      },
    ]);
    expect(
      await repository.findTeamMemberEvidence("entity_integration_evidence"),
    ).toEqual([
      {
        entityLogicalId: "entity_integration_member",
        displayName: "Member One",
        relationshipClaimId: "claim_integration_team",
        nameClaimId: "claim_integration_member_name",
        sourceLogicalId: "source_integration_member",
        sourceSystem: "integration",
        sourceNativeId: "member-1",
      },
    ]);
  });
});
