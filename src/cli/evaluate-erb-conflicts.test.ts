import { describe, expect, it, vi } from "vitest";

import { freezeConflictRuntime } from "@/evaluation/erb-conflict-runtime";
import { parseEvaluateErbConflictArgs, runErbConflictEvaluation } from "./evaluate-erb-conflicts";

describe("parseEvaluateErbConflictArgs", () => {
  it("requires the four explicit artifact paths", () => {
    expect(
      parseEvaluateErbConflictArgs([
        "--runtime", "runtime.json",
        "--labels", "questions.jsonl",
        "--output", "report.json",
        "--answers", "answers.jsonl",
      ]),
    ).toEqual({ runtime: "runtime.json", labels: "questions.jsonl", output: "report.json", answers: "answers.jsonl" });
    expect(() => parseEvaluateErbConflictArgs([])).toThrow(/Usage:/);
    expect(() => parseEvaluateErbConflictArgs(["--runtime", "x", "--runtime", "y"])).toThrow(/Usage:/);
  });
});

describe("runErbConflictEvaluation", () => {
  it("validates and freezes runtime input before opening labels", async () => {
    const reads: string[] = [];
    const readText = vi.fn(async (file: string) => {
      reads.push(file);
      if (file === "runtime.json") return '{"schemaVersion":1,"bad":true}';
      throw new Error("labels must not be opened");
    });

    await expect(
      runErbConflictEvaluation(
        { runtime: "runtime.json", labels: "labels.jsonl", output: "out.json", answers: "answers.jsonl" },
        { readText, writeText: vi.fn(), judge: vi.fn() },
      ),
    ).rejects.toThrow(/frozen runtime/i);
    expect(reads).toEqual(["runtime.json"]);
  });

  it("writes a complete report and ERB-compatible answer row", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      promptVersion: "conflict-observation-v7",
      cases: [{
        questionId: "qst_0411",
        question: "Current value?",
        questionType: "conflicting_info" as const,
        sourceTypes: ["jira"],
        maximumDocuments: 2,
      }],
    };
    const runtime = freezeConflictRuntime({
      manifest,
      extraction: {
        schemaVersion: 1,
        runtime: { model: "sourcetruce-extractor", promptVersion: "conflict-observation-v7" },
        cases: [{
          questionId: "qst_0411",
          question: "Current value?",
          sourceTypes: ["jira"],
          candidateSelection: { maximumDocuments: 2, selectedSourceObjectIds: ["s1", "s2"] },
          extractions: [
            { sourceObjectId: "s1", sourceNativeId: "d1", status: "accepted", observation: { value: "new" }, latencyMs: 1 },
            { sourceObjectId: "s2", sourceNativeId: "d2", status: "accepted", observation: { value: "old" }, latencyMs: 1 },
          ],
        }],
      },
      promotions: [{ questionId: "qst_0411", status: "resolved", winningValue: "new" }],
    });
    const label = JSON.stringify({
      question_id: "qst_0411",
      question_type: "conflicting_info",
      question: "Current value?",
      expected_doc_ids: ["d1", "d2"],
      gold_answer: "new",
      answer_facts: ["new"],
    });
    const writes = new Map<string, string>();
    const report = await runErbConflictEvaluation(
      { runtime: "runtime.json", labels: "labels.jsonl", output: "out.json", answers: "answers.jsonl" },
      {
        readText: async (file) => file === "runtime.json" ? JSON.stringify(runtime) : `${label}\n`,
        writeText: async (file, body) => { writes.set(file, body); },
        judge: async () => ({
          decision: { correct: true, completeness: 1, satisfiedFactIndexes: [0], reason: "complete" },
          rawOutput: "raw",
          latencyMs: 3,
          model: "sourcetruce-extractor",
          promptVersion: "erb-answer-evaluation-v1",
        }),
      },
    );

    expect(report.evaluation).toMatchObject({
      labelsLoadedAfterRuntimeFreeze: true,
      frozenRuntimeDigest: runtime.digest,
    });
    expect(writes.get("answers.jsonl")?.trim()).toBe(
      JSON.stringify({
        question_id: "qst_0411",
        answer: runtime.cases[0]?.answer,
        document_ids: ["d1", "d2"],
      }),
    );
    expect(JSON.parse(writes.get("out.json")!)).toMatchObject({ aggregate: { attempted: 1, answerCorrectness: 1 } });
  });
});
