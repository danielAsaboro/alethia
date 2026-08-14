import { describe, expect, it } from "vitest";
import { listJudgeCases } from "./case-registry";

describe("judge case registry", () => {
  it("contains four runtime-safe evidence court scenarios", () => {
    const cases = listJudgeCases();
    expect(cases.map((item) => item.kind).sort()).toEqual(["alignment", "conflict", "identity", "knowledge_boundary"]);
    const serialized = JSON.stringify(cases);
    expect(serialized).not.toMatch(/gold_answer|answer_facts|expected_doc_ids/);
    expect(serialized).not.toMatch(/entityLogicalId|predicateFamily/);
  });
});
