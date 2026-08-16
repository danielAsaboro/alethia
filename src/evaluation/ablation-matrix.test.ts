import { describe, expect, it } from "vitest";

import type { Claim, VerdictInput } from "@/domain/ontology";
import { evaluateAblationMatrix } from "./ablation-matrix";

const claim = (id: string, predicate = "setting", value = id): Claim => ({
  id,
  subjectEntityId: "entity",
  predicate,
  object: { kind: "literal", value },
  sourceObjectId: `source-${id}`,
  sourceSystem: "jira",
  extractionMethod: "deterministic",
  extractorVersion: "test",
});
const complete = { sufficient: true, missing: [] };
const resolved = { status: "resolved", entityId: "entity" } as const;
const verdictInput = (claims: Claim[]): VerdictInput => ({ claims, conflicts: [], coverage: complete, identity: resolved });

describe("evaluateAblationMatrix", () => {
  it("measures all five deterministic policy removals through production verdict logic", () => {
    const left = claim("left", "file_owner", "A");
    const right = claim("right", "opportunity_owner", "B");
    const matrix = evaluateAblationMatrix({
      conflict: {
        ...verdictInput([left, right]),
        conflicts: [{ id: "c", leftClaimId: "left", rightClaimId: "right", resolution: "left", policyId: "lifecycle-v1" }],
      },
      coverage: { claims: [], conflicts: [], coverage: { sufficient: false, missing: [{ sourceSystem: "herb", objectType: "employee", predicateFamily: "location", reason: "slice_missing" }] }, identity: resolved },
      identity: { ...verdictInput([left]), identity: { status: "ambiguous", candidateEntityIds: ["entity", "other"] } },
      alignment: { left, right, verdict: verdictInput([left, right]) },
      nativePath: { verdict: verdictInput([left]), nativeProofPresent: true, clientPathFound: true, nativeRoundTrips: 1, clientRoundTrips: 4 },
    });

    expect(matrix.map((item) => item.id)).toEqual([
      "no_conflict_policy",
      "no_coverage_gate",
      "no_identity_blockers",
      "naive_field_alignment",
      "no_graph_traversal",
    ]);
    expect(matrix).toMatchObject([
      { baselineVerdict: "SUPPORTED", ablatedVerdict: "DISPUTED" },
      { baselineVerdict: "UNKNOWN", ablatedVerdict: "NOT_FOUND" },
      { baselineVerdict: "UNKNOWN", ablatedVerdict: "SUPPORTED" },
      { baselineVerdict: "SUPPORTED", ablatedVerdict: "DISPUTED" },
      { baselineVerdict: "SUPPORTED", ablatedVerdict: "SUPPORTED", baselineRoundTrips: 1, ablatedRoundTrips: 4 },
    ]);
    expect(matrix.every((item) => item.explanation.length > 20)).toBe(true);
  });

  it("requires the real native-path baseline proof", () => {
    expect(() => evaluateAblationMatrix({
      conflict: verdictInput([claim("a")]),
      coverage: verdictInput([]),
      identity: verdictInput([claim("a")]),
      alignment: { left: claim("a"), right: claim("b"), verdict: verdictInput([claim("a"), claim("b")]) },
      nativePath: { verdict: verdictInput([claim("a")]), nativeProofPresent: false, clientPathFound: false, nativeRoundTrips: 0, clientRoundTrips: 0 },
    })).toThrow(/native path proof/i);
  });
});
