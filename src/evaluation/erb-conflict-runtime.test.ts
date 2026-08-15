import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertNoEvaluationLabels,
  freezeConflictRuntime,
  parseFrozenConflictRuntime,
  parseRuntimeManifest,
  type ConflictExtractionArtifact,
  type ConflictPromotion,
} from "./erb-conflict-runtime";

async function checkedInManifest() {
  return parseRuntimeManifest(
    JSON.parse(
      await readFile(
        path.resolve("evaluation/erb-conflicts.runtime.json"),
        "utf8",
      ),
    ) as unknown,
  );
}

function runtimeInputs(
  manifest: Awaited<ReturnType<typeof checkedInManifest>>,
): { extraction: ConflictExtractionArtifact; promotions: ConflictPromotion[] } {
  const extraction: ConflictExtractionArtifact = {
    schemaVersion: 1,
    runtime: { model: "sourcetruce-extractor", promptVersion: manifest.promptVersion },
    cases: manifest.cases.map((item) => ({
      questionId: item.questionId,
      question: item.question,
      sourceTypes: item.sourceTypes,
      candidateSelection: {
        maximumDocuments: item.maximumDocuments,
        selectedSourceObjectIds: [`source-${item.questionId}-a`, `source-${item.questionId}-b`],
      },
      extractions:
        item.questionId === "qst_0412"
          ? [
              {
                sourceObjectId: `source-${item.questionId}-a`,
                sourceNativeId: `doc-${item.questionId}-a`,
                status: "accepted",
                observation: { value: "96%", evidenceQuote: "Current correctness is 96%." },
                latencyMs: 4,
              },
              {
                sourceObjectId: `source-${item.questionId}-b`,
                sourceNativeId: `doc-${item.questionId}-b`,
                status: "rejected",
                error: "truncated JSON",
                latencyMs: 5,
              },
            ]
          : [
              {
                sourceObjectId: `source-${item.questionId}-a`,
                sourceNativeId: `doc-${item.questionId}-a`,
                status: "accepted",
                observation: { value: "new value", evidenceQuote: "Updated current setting: new value." },
                latencyMs: 4,
              },
              {
                sourceObjectId: `source-${item.questionId}-b`,
                sourceNativeId: `doc-${item.questionId}-b`,
                status: "accepted",
                observation: { value: "old value", evidenceQuote: "Previous setting: old value." },
                latencyMs: 5,
              },
            ],
    })),
  };
  const promotions: ConflictPromotion[] = manifest.cases.map((item, index) =>
    item.questionId === "qst_0412"
      ? {
          questionId: item.questionId,
          status: "skipped",
          reason: "needs_two_accepted_observations",
        }
      : index % 3 === 0
        ? {
            questionId: item.questionId,
            status: "resolved",
            winningValue: "new value",
          }
        : {
            questionId: item.questionId,
            status: "unresolved",
            winningValue: null,
          },
  );
  return { extraction, promotions };
}

describe("label-free ERB conflict runtime", () => {
  it("checks in exactly 20 bounded conflict cases with no evaluation labels", async () => {
    const manifest = await checkedInManifest();
    expect(manifest.cases).toHaveLength(20);
    expect(manifest.cases.map((item) => item.questionId)).toEqual(
      Array.from({ length: 20 }, (_, index) => `qst_${String(411 + index).padStart(4, "0")}`),
    );
    expect(manifest.cases.every((item) => item.questionType === "conflicting_info")).toBe(true);
    expect(manifest.cases.every((item) => item.maximumDocuments === 2)).toBe(true);
    expect(() => assertNoEvaluationLabels(manifest)).not.toThrow();
  });

  it("rejects forbidden labels by nested key or serialized value", () => {
    expect(() =>
      assertNoEvaluationLabels({ safe: { gold_answer: "hidden" } }),
    ).toThrow(/evaluation label/i);
    expect(() =>
      assertNoEvaluationLabels({ safe: "prompt mentions expected_doc_ids" }),
    ).toThrow(/evaluation label/i);
    expect(() =>
      assertNoEvaluationLabels({ safe: [{ answer_facts: [] }] }),
    ).toThrow(/evaluation label/i);
  });

  it("freezes every attempt, including rejected qst_0412, with a stable digest", async () => {
    const manifest = await checkedInManifest();
    const inputs = runtimeInputs(manifest);
    const first = freezeConflictRuntime({ manifest, ...inputs });
    const reordered = freezeConflictRuntime({
      manifest: { ...manifest, cases: [...manifest.cases].reverse() },
      extraction: {
        ...inputs.extraction,
        cases: [...inputs.extraction.cases]
          .reverse()
          .map((item) => ({ ...item, extractions: [...item.extractions].reverse() })),
      },
      promotions: [...inputs.promotions].reverse(),
    });

    expect(first.summary).toEqual({
      attempted: 20,
      completed: 19,
      rejected: 1,
      failed: 0,
    });
    expect(first.cases).toHaveLength(20);
    expect(first.cases.map((item) => item.questionId)).toEqual(
      [...first.cases.map((item) => item.questionId)].sort(),
    );
    expect(first.cases.find((item) => item.questionId === "qst_0412")).toMatchObject({
      status: "rejected",
      verdict: null,
      answer: null,
      evidenceDocumentIds: [],
      failureReason: expect.stringMatching(/needs_two_accepted_observations.*truncated JSON/),
    });
    expect(first.cases.find((item) => item.questionId === "qst_0413")).toMatchObject({
      status: "completed",
      verdict: "DISPUTED",
      answer: expect.stringMatching(/new value[\s\S]*Updated current setting[\s\S]*Previous setting/),
    });
    expect(first.cases.find((item) => item.questionId === "qst_0411")?.answer).toMatch(
      /not the current answer/i,
    );
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).toBe(reordered.digest);
    expect(first).toEqual(reordered);
    expect(parseFrozenConflictRuntime(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(() =>
      parseFrozenConflictRuntime({
        ...first,
        cases: first.cases.map((item, index) =>
          index === 0 ? { ...item, answer: "tampered" } : item,
        ),
      }),
    ).toThrow(/digest/i);
    expect(() => assertNoEvaluationLabels(first)).not.toThrow();
  });

  it("links a normalized percentage winner back to its grounded extraction", async () => {
    const manifest = await checkedInManifest();
    const inputs = runtimeInputs(manifest);
    const extracted = inputs.extraction.cases.find(
      (item) => item.questionId === "qst_0411",
    );
    const promotion = inputs.promotions.find(
      (item) => item.questionId === "qst_0411",
    );
    if (!extracted || !promotion || promotion.status !== "resolved") {
      throw new Error("qst_0411 fixtures are missing");
    }
    extracted.extractions[0].observation = {
      value: "Updated target: reserve 30% (previous suggestion was 20%).",
      evidenceQuote: "Applied update: reserve 30%; the previous suggestion was 20%.",
    };
    promotion.winningValue = "30%";

    const frozen = freezeConflictRuntime({ manifest, ...inputs });

    expect(frozen.cases.find((item) => item.questionId === "qst_0411")).toMatchObject({
      status: "completed",
      verdict: "SUPPORTED",
      answer: expect.stringMatching(/Grounded answer: 30%[\s\S]*Applied update/),
    });
  });
});
