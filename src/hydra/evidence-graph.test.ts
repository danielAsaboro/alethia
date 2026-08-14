import { describe, expect, it } from "vitest";

import type { ClaimObservation } from "@/domain/evidence";
import { consolidateClaims } from "@/claims/consolidate-claims";
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
});
