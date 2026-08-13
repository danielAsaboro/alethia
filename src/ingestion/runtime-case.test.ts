import { describe, expect, it } from "vitest";

import { runtimeCaseSchema } from "./runtime-case";

const safeCase = {
  questionId: "qst_0411",
  question:
    "On Streamly AI's dedicated pool, what percentage should be reserved?",
  sourceTypes: ["google_drive", "jira"],
  predicateFamily: "capacity_policy",
  coverageRequirement: {
    slices: [
      {
        sourceSystem: "jira",
        objectType: "document",
        predicateFamily: "capacity_policy",
        contentScope: "body",
      },
    ],
  },
};

describe("runtimeCaseSchema", () => {
  it("accepts a runtime-safe question and coverage requirement", () => {
    expect(runtimeCaseSchema.parse(safeCase)).toEqual(safeCase);
  });

  it.each(["expected_doc_ids", "gold_answer", "answer_facts"])(
    "rejects leaked evaluation field %s",
    (field) => {
      expect(() =>
        runtimeCaseSchema.parse({ ...safeCase, [field]: ["secret"] }),
      ).toThrow();
    },
  );

  it("serializes without benchmark evaluation labels", () => {
    const serialized = JSON.stringify(runtimeCaseSchema.parse(safeCase));
    expect(serialized).not.toMatch(
      /expected_doc_ids|gold_answer|answer_facts/,
    );
  });
});
