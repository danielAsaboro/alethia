import { describe, expect, it } from "vitest";

import type { ClaimObservation } from "@/domain/evidence";
import { consolidateClaims } from "@/claims/consolidate-claims";
import { decideAlignment } from "@/alignment/alignment-policy";
import { createSourceSchemaTerm } from "@/alignment/source-terms";
import { mapEvidenceSystemToGraph } from "./evidence-graph";

function observation(
  id: string,
  method: "deterministic" | "qvac",
  value: string,
  sourceObjectId = "source_employee",
): ClaimObservation {
  return {
    id,
    claimCandidate: {
      id: `candidate_${id}`,
      subjectEntityId: "entity_person",
      predicate: "has_role",
      object: { kind: "literal", value },
      sourceObjectId,
      sourceSystem: "herb",
      extractionMethod: method,
      extractorVersion: `${method}:test`,
    },
    evidenceQuote: `${value} source evidence`,
    method,
    extractorVersion: `${method}:test`,
  };
}

describe("mapEvidenceSystemToGraph", () => {
  it("maps canonical claims, observations, conflict, and policy without duplicate claims", () => {
    const supported = consolidateClaims([
      observation("observation_structural", "deterministic", "Engineer"),
      observation("observation_qvac", "qvac", "Engineer"),
    ]);
    const disputed = consolidateClaims([
      observation(
        "observation_manager",
        "qvac",
        "Manager",
        "source_profile",
      ),
    ]);
    const claims = [...supported.claims, ...disputed.claims];
    const conflict = {
      id: "conflict_role",
      leftClaimId: supported.claims[0].id,
      rightClaimId: disputed.claims[0].id,
      resolution: "left" as const,
      policyId: "policy_role_authority",
    };

    const graph = mapEvidenceSystemToGraph({
      claims,
      observations: [...supported.observations, ...disputed.observations],
      sources: [
        {
          id: "source_employee",
          sourceSystem: "herb",
          sourceNativeId: "employee_1",
          payloadDigest: "digest_employee",
        },
        {
          id: "source_profile",
          sourceSystem: "herb",
          sourceNativeId: "profile_1",
          payloadDigest: "digest_profile",
        },
      ],
      conflicts: [conflict],
      policies: [
        {
          id: "policy_role_authority",
          predicate: "has_role",
          sourceSystem: "herb",
          priority: 10,
          rationale: "Structural employee metadata is authoritative",
        },
      ],
    });

    const claimNodes = graph.nodes.filter((node) => node.label === "Claim");
    expect(claimNodes).toHaveLength(2);
    expect(new Set(claimNodes.map((node) => node.logicalId)).size).toBe(2);
    expect(
      graph.nodes.filter((node) => node.label === "ExtractionObservation"),
    ).toHaveLength(3);
    expect(
      graph.edges.filter((edge) => edge.type === "HAS_OBSERVATION"),
    ).toHaveLength(3);
    expect(
      graph.edges.filter((edge) => edge.type === "CONTRADICTS"),
    ).toEqual([
      expect.objectContaining({
        sourceLogicalId: conflict.leftClaimId,
        targetLogicalId: conflict.rightClaimId,
      }),
    ]);
    expect(
      graph.edges.filter((edge) => edge.type === "DECIDED_BY"),
    ).toEqual([
      expect.objectContaining({
        sourceLogicalId: conflict.id,
        targetLogicalId: conflict.policyId,
      }),
    ]);
  });

  it("maps accepted and rejected ontology alignment evidence", () => {
    const sourceTerm = createSourceSchemaTerm({
      sourceSystem: "google_drive",
      objectType: "document",
      surface: "owner",
      contextualRole: "file_metadata",
    });
    const acceptedTerm = {
      id: "ontology_file_owner",
      name: "FILE_OWNER",
      domain: "Document",
      range: "Person",
    };
    const rejectedTerm = {
      id: "ontology_repository_owner",
      name: "REPOSITORY_OWNER",
      domain: "Repository",
      range: "Team",
    };
    const rule = {
      id: "rule_drive_file_owner_v1",
      version: "alignment-registry-v1",
      sourceSystem: "google_drive",
      objectType: "document",
      surface: "owner",
      contextualRole: "file_metadata",
      targetOntologyTermId: acceptedTerm.id,
      domain: "Document",
      range: "Person",
    };
    const accepted = decideAlignment(
      {
        term: sourceTerm,
        candidate: acceptedTerm,
        evidenceObservationIds: [],
      },
      [rule],
    );
    const rejected = decideAlignment(
      {
        term: sourceTerm,
        candidate: rejectedTerm,
        evidenceObservationIds: [],
      },
      [rule],
    );

    const graph = mapEvidenceSystemToGraph({
      claims: [],
      observations: [],
      sources: [
        {
          id: "source_drive_owner",
          sourceSystem: "google_drive",
          sourceNativeId: "drive_1",
          payloadDigest: "digest_drive",
        },
      ],
      conflicts: [],
      policies: [],
      alignment: {
        sourceTerms: [sourceTerm],
        ontologyTerms: [acceptedTerm, rejectedTerm],
        decisions: [accepted, rejected],
        observations: [
          {
            sourceObjectId: "source_drive_owner",
            sourceTermId: sourceTerm.id,
          },
        ],
      },
    });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "OBSERVED_AS" }),
        expect.objectContaining({
          type: "MAPS_TO",
          sourceLogicalId: sourceTerm.id,
          targetLogicalId: acceptedTerm.id,
        }),
        expect.objectContaining({
          type: "REJECTED_MAPPING",
          sourceLogicalId: rejected.id,
          targetLogicalId: rejectedTerm.id,
        }),
      ]),
    );
    expect(
      graph.edges.filter(
        (edge) => edge.type === "CONSIDERS" && edge.targetLogicalId === sourceTerm.id,
      ),
    ).toHaveLength(2);
    expect(
      graph.nodes
        .filter((node) => node.label === "AlignmentDecision")
        .every((node) => typeof node.properties.inputDigest === "string" && /^[a-f0-9]{64}$/.test(node.properties.inputDigest)),
    ).toBe(true);
  });

  it("maps explicit source-version lineage without guessing recency", () => {
    const graph = mapEvidenceSystemToGraph({
      claims: [],
      observations: [],
      sources: [
        {
          id: "source_version_anchor",
          sourceSystem: "jira",
          sourceNativeId: "dsid_shared",
          payloadDigest: "digest_a",
        },
        {
          id: "source_version_variant",
          sourceSystem: "jira",
          sourceNativeId: "dsid_shared",
          payloadDigest: "digest_b",
        },
      ],
      sourceRelations: [
        {
          type: "VERSION_OF",
          sourceObjectId: "source_version_variant",
          targetSourceObjectId: "source_version_anchor",
          reason: "same_native_id_divergent_digest",
          orderKnown: false,
        },
      ],
      conflicts: [],
      policies: [],
    });

    expect(graph.edges).toEqual([
      expect.objectContaining({
        type: "VERSION_OF",
        sourceLogicalId: "source_version_variant",
        targetLogicalId: "source_version_anchor",
        properties: {
          reason: "same_native_id_divergent_digest",
          orderKnown: false,
        },
      }),
    ]);
  });
});
