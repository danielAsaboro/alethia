import { describe, expect, it } from "vitest";
import { scanRuntimeSource } from "./anti-leakage";

describe("scanRuntimeSource", () => {
  it.each([
    ["evaluation_field", "const payload = { gold_answer: answer };"],
    ["benchmark_case_id", "if (id === 'qst_0411') return winner;"],
    ["label_import", "import labels from '../../resources/gold-labels.json';"],
    ["verdict_revealing_prompt", "const prompt = 'Use the expected verdict resolved';"],
  ])("blocks %s leakage", (kind, source) => {
    expect(scanRuntimeSource("src/application/unsafe.ts", source)).toMatchObject([{ kind }]);
  });

  it("does not flag ordinary runtime ontology code", () => {
    expect(scanRuntimeSource("src/application/safe.ts", "export const verdict = evidence.length ? 'supported' : 'unknown';")).toEqual([]);
  });

  it("allows the dedicated runtime rejection guard to name forbidden fields", () => {
    expect(scanRuntimeSource("src/ingestion/runtime-case.ts", "const forbidden = /gold_answer|answer_facts/;")).toEqual([]);
  });
});
