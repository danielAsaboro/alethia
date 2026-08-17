import { describe, expect, it } from "vitest";

import { freezeCausalRuntime } from "./causal-runtime";

describe("freezeCausalRuntime", () => {
  it("freezes graph receipts and real matched-length distractors without label fields", () => {
    const runtime = freezeCausalRuntime({
      datasetRevision: "digest-1",
      seed: "seed-1",
      cases: [{
        caseId: "q1",
        question: "What is current?",
        graph: {
          verdict: "SUPPORTED",
          currentSourceObjectIds: ["s1"],
          supersededSourceObjectIds: ["s2"],
          conflictSourceObjectIds: ["s1", "s2"],
          hydraQueryIds: ["hq1", "hq2"],
        },
        retrieved: [
          { id: "s1", sourceSystem: "drive", text: "applied limit thirty percent" },
          { id: "s2", sourceSystem: "jira", text: "proposal limit twenty percent" },
        ],
      }],
      replacementSources: [
        { id: "r1", sourceSystem: "slack", text: "release monitoring remains enabled after rollout completion" },
        { id: "r2", sourceSystem: "gmail", text: "owners meet after deployment for routine operational review" },
      ],
    });

    expect(runtime.cases).toHaveLength(1);
    expect(runtime.cases[0]).toMatchObject({
      retrievalDocumentIds: ["s1", "s2"],
      graph: { hydraQueryIds: ["hq1", "hq2"] },
    });
    expect(runtime.cases[0]!.documents).toHaveLength(4);
    expect(runtime.cases[0]!.documents.slice(2).map((row) => row.tokenCount)).toEqual([4, 4]);
    expect(JSON.stringify(runtime)).not.toMatch(/gold|expected_doc|answer_facts|selectedAnswer|expectedVerdict/i);
  });

  it("rejects cases without live Hydra query receipts", () => {
    expect(() => freezeCausalRuntime({
      datasetRevision: "digest-1",
      seed: "seed-1",
      replacementSources: [],
      cases: [{
        caseId: "q1",
        question: "Question",
        graph: { verdict: "DISPUTED", currentSourceObjectIds: [], supersededSourceObjectIds: [], conflictSourceObjectIds: ["s1"], hydraQueryIds: [] },
        retrieved: [{ id: "s1", sourceSystem: "drive", text: "real record" }],
      }],
    })).toThrow(/Hydra query receipts/i);
  });
});
