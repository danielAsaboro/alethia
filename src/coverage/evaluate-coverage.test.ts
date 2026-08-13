import { describe, expect, it } from "vitest";

import { evaluateCoverage } from "./evaluate-coverage";

const requirement = {
  slices: [
    {
      sourceSystem: "github",
      objectType: "pull_request",
      predicateFamily: "merge_status",
      contentScope: "metadata" as const,
    },
  ],
};

describe("evaluateCoverage", () => {
  it("accepts a completed slice that examined the required predicate", () => {
    expect(
      evaluateCoverage(requirement, [
        {
          id: "coverage_github_pr",
          ingestionRunId: "run_1",
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamilies: ["merge_status", "authorship"],
          contentScope: "metadata",
          status: "complete",
        },
      ]),
    ).toEqual({ sufficient: true, missing: [] });
  });

  it("reports a source and object type that were never ingested", () => {
    expect(evaluateCoverage(requirement, [])).toEqual({
      sufficient: false,
      missing: [
        {
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamily: "merge_status",
          reason: "slice_missing",
        },
      ],
    });
  });

  it("does not treat a failed ingestion as coverage", () => {
    expect(
      evaluateCoverage(requirement, [
        {
          id: "coverage_github_pr",
          ingestionRunId: "run_1",
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamilies: ["merge_status"],
          contentScope: "metadata",
          status: "failed",
          failureReason: "invalid_json",
        },
      ]),
    ).toEqual({
      sufficient: false,
      missing: [
        {
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamily: "merge_status",
          reason: "ingestion_failed",
        },
      ],
    });
  });

  it("distinguishes an ingested object type from an examined predicate", () => {
    expect(
      evaluateCoverage(requirement, [
        {
          id: "coverage_github_pr",
          ingestionRunId: "run_1",
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamilies: ["authorship"],
          contentScope: "metadata",
          status: "complete",
        },
      ]),
    ).toEqual({
      sufficient: false,
      missing: [
        {
          sourceSystem: "github",
          objectType: "pull_request",
          predicateFamily: "merge_status",
          reason: "predicate_not_examined",
        },
      ],
    });
  });
});
