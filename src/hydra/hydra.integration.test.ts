import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { consolidateClaims } from "@/claims/consolidate-claims";
import type { ClaimObservation } from "@/domain/evidence";
import { stableId } from "@/domain/ids";
import {
  HydraRepository,
  type GraphWriteBundle,
} from "./client";
import { mapEvidenceSystemToGraph } from "./evidence-graph";

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
      {
        logicalId: "entity_integration_native_path",
        label: "Entity",
        properties: { kind: "native_path_subject" },
      },
      {
        logicalId: "claim_integration_native_path",
        label: "Claim",
        properties: {
          predicate: "native_path_status",
          objectJson: JSON.stringify({ kind: "literal", value: "verified" }),
        },
      },
      {
        logicalId: "observation_integration_native_path",
        label: "ExtractionObservation",
        properties: { method: "integration", evidenceQuote: "verified" },
      },
      {
        logicalId: "source_integration_native_path",
        label: "SourceObject",
        properties: { sourceSystem: "integration", nativeId: "native-path-1" },
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
      {
        logicalId: "edge_integration_native_asserts",
        type: "ASSERTS",
        sourceLabel: "Entity",
        sourceLogicalId: "entity_integration_native_path",
        targetLabel: "Claim",
        targetLogicalId: "claim_integration_native_path",
        properties: {},
      },
      {
        logicalId: "edge_integration_native_observation",
        type: "HAS_OBSERVATION",
        sourceLabel: "Claim",
        sourceLogicalId: "claim_integration_native_path",
        targetLabel: "ExtractionObservation",
        targetLogicalId: "observation_integration_native_path",
        properties: {},
      },
      {
        logicalId: "edge_integration_native_source",
        type: "SUPPORTED_BY",
        sourceLabel: "ExtractionObservation",
        sourceLogicalId: "observation_integration_native_path",
        targetLabel: "SourceObject",
        targetLogicalId: "source_integration_native_path",
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
    expect(presence).toEqual({ nodes: 12, edges: 9 });
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

    const nativePaths = await repository.findNativePaths({
      sourceLogicalId: "entity_integration_native_path",
      targetLogicalId: "source_integration_native_path",
      relationshipTypes: ["ASSERTS", "HAS_OBSERVATION", "SUPPORTED_BY"],
      maxLength: 3,
      pathCount: 1,
    });
    expect(nativePaths).toHaveLength(1);
    expect(nativePaths[0]).toMatchObject({
      operation: "algo.SPpaths",
      consistency: "strong",
      queryId: expect.stringMatching(/^sourcetruce-read-/),
      readEpoch: expect.any(Number),
      bookmark: expect.stringMatching(/^sgk:/),
      roundTrips: 1,
      pathLength: 3,
      nodes: [
        { logicalId: "entity_integration_native_path" },
        { logicalId: "claim_integration_native_path" },
        { logicalId: "observation_integration_native_path" },
        { logicalId: "source_integration_native_path" },
      ],
      relationships: [
        { type: "ASSERTS" },
        { type: "HAS_OBSERVATION" },
        { type: "SUPPORTED_BY" },
      ],
    });

    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => repository.findNativePaths({
        sourceLogicalId: "entity_integration_native_path",
        targetLogicalId: "source_integration_native_path",
        relationshipTypes: ["ASSERTS", "HAS_OBSERVATION", "SUPPORTED_BY"],
        maxLength: 3,
        pathCount: 1,
      })),
    );
    const queryIds = concurrent.flatMap((paths) => paths.map((item) => item.queryId));
    expect(queryIds).toHaveLength(20);
    expect(new Set(queryIds)).toHaveLength(20);
    expect(concurrent.every((paths) => paths.length === 1 && paths[0]?.roundTrips === 1)).toBe(true);
  });

  it("round-trips the real qst_0411 observation and decision paths", async () => {
    const configuredEvidencePath = process.env.ERB_CONFLICT_EXTRACTIONS;
    if (!configuredEvidencePath) {
      throw new Error("ERB_CONFLICT_EXTRACTIONS must point to a real extraction artifact");
    }
    const evidencePath = path.resolve(configuredEvidencePath);
    type RealExtraction = {
      cacheKey: string;
      status: string;
      sourceObjectId: string;
      sourceNativeId: string;
      sourceSystem: string;
      sourceDigest: string;
      observation?: {
        value: string | number | boolean;
        evidenceQuote: string;
        lifecycle: string;
      };
    };
    const artifact = JSON.parse(await readFile(evidencePath, "utf8")) as {
      cases: Array<{
        questionId: string;
        extractions: RealExtraction[];
      }>;
    };
    const realCase = artifact.cases.find(
      (candidate) => candidate.questionId === "qst_0411",
    );
    if (!realCase) throw new Error("Real qst_0411 case is missing");
    const accepted = realCase.extractions.filter(
      (extraction) => extraction.status === "accepted" && extraction.observation,
    );
    expect(accepted).toHaveLength(2);

    const subjectEntityId = stableId("entity", {
      kind: "infrastructure_pool",
      name: "dp-132-usw",
    });
    const inputObservations: ClaimObservation[] = accepted.map(
      (extraction) => ({
        id: stableId("observation", {
          cacheKey: extraction.cacheKey,
          promptVersion: "conflict-observation-v7",
        }),
        claimCandidate: {
          id: `candidate_${extraction.cacheKey}`,
          subjectEntityId,
          predicate: "conflict_answer",
          object: {
            kind: "literal",
            value: extraction.observation!.value,
          },
          sourceObjectId: extraction.sourceObjectId,
          sourceSystem: extraction.sourceSystem,
          extractionMethod: "qvac",
          extractorVersion: "qvac:sourcetruce-extractor:v7",
        },
        evidenceQuote: extraction.observation!.evidenceQuote,
        method: "qvac",
        extractorVersion: "qvac:sourcetruce-extractor:v7",
      }),
    );
    const consolidated = consolidateClaims(inputObservations);
    const observationForLifecycle = (lifecycle: string) =>
      consolidated.observations.find((observation) =>
        accepted.some(
          (extraction) =>
            extraction.observation?.lifecycle === lifecycle &&
            extraction.sourceObjectId ===
              observation.claimCandidate.sourceObjectId,
        ),
      );
    const appliedObservation = observationForLifecycle("applied");
    const proposalObservation = observationForLifecycle("proposal");
    if (!appliedObservation || !proposalObservation) {
      throw new Error("Real qst_0411 lifecycle pair is incomplete");
    }
    const conflictId = stableId("conflict", {
      questionId: "qst_0411",
      appliedClaimId: appliedObservation.claimCandidate.id,
      proposalClaimId: proposalObservation.claimCandidate.id,
    });
    const policyId = "policy_lifecycle_precedence_v1";
    const graph = mapEvidenceSystemToGraph({
      claims: consolidated.claims,
      observations: consolidated.observations,
      sources: accepted.map((extraction) => ({
        id: extraction.sourceObjectId,
        sourceSystem: extraction.sourceSystem,
        sourceNativeId: extraction.sourceNativeId,
        payloadDigest: extraction.sourceDigest,
      })),
      conflicts: [
        {
          id: conflictId,
          leftClaimId: appliedObservation.claimCandidate.id,
          rightClaimId: proposalObservation.claimCandidate.id,
          resolution: "left",
          policyId,
        },
      ],
      policies: [
        {
          id: policyId,
          predicate: "conflict_answer",
          sourceSystem: "enterprise",
          priority: 100,
          rationale: "Grounded applied state supersedes a grounded proposal",
        },
      ],
    });

    await repository.writeGraph(graph);
    await repository.writeGraph(graph);
    expect(await repository.getPresence(graph)).toEqual({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
    expect(await repository.findObservationEvidence(subjectEntityId)).toHaveLength(
      2,
    );
    expect(await repository.findConflictDecision(conflictId)).toMatchObject({
      conflictId,
      claimIds: expect.arrayContaining([
        appliedObservation.claimCandidate.id,
        proposalObservation.claimCandidate.id,
      ]),
      policyId,
    });
  });
});
