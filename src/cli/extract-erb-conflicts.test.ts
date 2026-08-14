import { describe, expect, it } from "vitest";

import {
  parseExtractErbConflictArgs,
  rankCandidateDocuments,
  toRuntimeConflictCase,
} from "./extract-erb-conflicts";

describe("parseExtractErbConflictArgs", () => {
  const complete = [
    "--documents",
    "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
    "--questions",
    "../resources/EnterpriseRAG-Bench/questions.jsonl",
    "--output",
    "../submission/evidence/qvac/erb-conflicts.json",
    "--limit",
    "1",
  ];

  it("requires every corpus, output, and bound explicitly", () => {
    expect(parseExtractErbConflictArgs(complete)).toEqual({
      documents:
        "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
      questions: "../resources/EnterpriseRAG-Bench/questions.jsonl",
      output: "../submission/evidence/qvac/erb-conflicts.json",
      limit: 1,
    });
  });

  it.each(["--documents", "--questions", "--output", "--limit"])(
    "rejects omission of %s",
    (flag) => {
      const index = complete.indexOf(flag);
      expect(() =>
        parseExtractErbConflictArgs([
          ...complete.slice(0, index),
          ...complete.slice(index + 2),
        ]),
      ).toThrow("Usage: npm run extract:erb-conflicts");
    },
  );

  it("rejects an unbounded or invalid limit", () => {
    expect(() =>
      parseExtractErbConflictArgs([
        ...complete.slice(0, -1),
        "0",
      ]),
    ).toThrow("Usage: npm run extract:erb-conflicts");
  });

  it("drops gold labels before creating the runtime case", () => {
    const runtime = toRuntimeConflictCase({
      question_id: "qst_0411",
      question_type: "conflicting_info",
      question: "What percentage applies to pool dp-132-usw?",
      source_types: ["jira"],
      expected_doc_ids: ["secret_doc"],
      gold_answer: "secret answer",
      answer_facts: ["secret fact"],
    });

    expect(runtime).toEqual({
      questionId: "qst_0411",
      question: "What percentage applies to pool dp-132-usw?",
      sourceTypes: ["jira"],
    });
    expect(JSON.stringify(runtime)).not.toMatch(
      /expected_doc_ids|gold_answer|answer_facts|secret/,
    );
  });

  it("ranks candidates from question and source text without gold IDs", () => {
    const ranked = rankCandidateDocuments(
      {
        questionId: "qst_0411",
        question: "What burst credit percentage applies to dp-132-usw?",
        sourceTypes: ["jira"],
      },
      [
        {
          sourceObjectId: "source_unrelated",
          sourceNativeId: "doc_unrelated",
          sourceSystem: "jira",
          title: "Office lunch",
          body: "Menu planning",
          payloadDigest: "digest_unrelated",
        },
        {
          sourceObjectId: "source_pool",
          sourceNativeId: "doc_pool",
          sourceSystem: "jira",
          title: "dp-132-usw burst credits",
          body: "Reserve a percentage for priority traffic.",
          payloadDigest: "digest_pool",
        },
      ],
      1,
    );

    expect(ranked.map((document) => document.sourceObjectId)).toEqual([
      "source_pool",
    ]);
  });
});
