import { describe, expect, test } from "vitest";

import { CAUSAL_ARM_IDS, type CausalCaseInput } from "./causal-arms";
import { diagnoseCausalRun, type LabelFreeCausalResultRow } from "./causal-diagnosis";

const causalCase: CausalCaseInput = {
  caseId: "case-1",
  question: "Which source-derived value is controlling?",
  documents: [
    { id: "old", sourceSystem: "jira", text: "Limit is 10.", tokenCount: 3, lifecycle: "superseded" },
    { id: "new", sourceSystem: "drive", text: "Limit is 20.", tokenCount: 3, lifecycle: "current" },
    { id: "distractor", sourceSystem: "slack", text: "Unrelated weekly note.", tokenCount: 3, lifecycle: "unknown" },
  ],
  retrievalDocumentIds: ["old", "new"],
  graph: {
    currentDocumentIds: ["new"],
    supersededDocumentIds: ["old"],
    conflictDocumentIds: ["old", "new"],
    verdict: "SUPPORTED",
    hydraQueryIds: ["query-1"],
  },
};

function completeRows(): LabelFreeCausalResultRow[] {
  return CAUSAL_ARM_IDS.map((armId) => ({
    caseId: causalCase.caseId,
    armId,
    status: "completed",
    response: { answer: "20", verdict: "SUPPORTED", evidenceDocumentIds: ["new"] },
    responseText: '{"answer":"20","verdict":"SUPPORTED","evidenceDocumentIds":["new"]}',
    rawError: null,
    contextDocumentIds: ["old", "new"],
    removedDocumentIds: [],
    replacementDocumentIds: [],
    contextTokenBudget: 6,
    budgetPaddingTokens: 0,
  }));
}

describe("diagnoseCausalRun", () => {
  test("rejects evaluation labels and incomplete arm accounting", () => {
    expect(() => diagnoseCausalRun({
      runtime: { labelFree: true, cases: [{ ...causalCase, gold_answer: "20" } as CausalCaseInput] },
      results: completeRows(),
    })).toThrow(/forbidden evaluation field/i);

    expect(() => diagnoseCausalRun({
      runtime: { labelFree: true, cases: [causalCase] },
      results: completeRows().slice(1),
    })).toThrow(/complete 10-arm accounting/i);
  });

  test("classifies structural conflict-policy, context-budget, timeout, and scorer failures without correctness labels", () => {
    const rows = completeRows();
    const full = rows.find((row) => row.armId === "full_alethia_grounding")!;
    full.contextDocumentIds = ["distractor"];
    full.removedDocumentIds = ["old", "new"];
    full.replacementDocumentIds = ["distractor"];
    full.contextTokenBudget = 3;
    const noConflict = rows.find((row) => row.armId === "no_conflict_policy")!;
    noConflict.status = "failed";
    noConflict.response = null;
    noConflict.rawError = "The operation was aborted due to timeout";
    const plain = rows.find((row) => row.armId === "plain_retrieval")!;
    plain.status = "rejected";
    plain.response = null;
    plain.rawError = "Causal generation returned malformed JSON";

    const report = diagnoseCausalRun({ runtime: { labelFree: true, cases: [causalCase] }, results: rows });

    expect(report.cases[0]?.categories).toEqual(expect.arrayContaining([
      "conflict-policy",
      "context-budget",
      "model-timeout",
      "scorer-failure",
    ]));
    expect(report.cases[0]?.observations).toContain("full policy removed every retrieved source record");
    expect(report.labelsOpened).toBe(false);
  });
});
