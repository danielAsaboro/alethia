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
    "--manifest",
    "evaluation/erb-conflicts.runtime.json",
    "--output",
    "../submission/evidence/qvac/erb-conflicts.json",
    "--limit",
    "1",
  ];

  it("requires every corpus, output, and bound explicitly", () => {
    expect(parseExtractErbConflictArgs(complete)).toEqual({
      documents:
        "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
      manifest: "evaluation/erb-conflicts.runtime.json",
      output: "../submission/evidence/qvac/erb-conflicts.json",
      limit: 1,
    });
  });

  it.each(["--documents", "--manifest", "--output", "--limit"])(
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

  it("accepts only the strict label-free manifest case shape", () => {
    const runtime = toRuntimeConflictCase({
      questionId: "qst_0411",
      questionType: "conflicting_info",
      question: "What percentage applies to pool dp-132-usw?",
      sourceTypes: ["jira"],
      maximumDocuments: 2,
    });

    expect(runtime).toEqual({
      questionId: "qst_0411",
      question: "What percentage applies to pool dp-132-usw?",
      questionType: "conflicting_info",
      sourceTypes: ["jira"],
      maximumDocuments: 2,
    });
    expect(() =>
      toRuntimeConflictCase({
        questionId: "qst_0411",
        questionType: "conflicting_info",
        question: "What percentage applies?",
        sourceTypes: ["jira"],
        maximumDocuments: 2,
        gold_answer: "secret answer",
      }),
    ).toThrow(/evaluation label|invalid runtime shape/i);
  });

  it("ranks candidates from question and source text without gold IDs", () => {
    const ranked = rankCandidateDocuments(
      {
        questionId: "qst_0411",
        question: "What burst credit percentage applies to dp-132-usw?",
        questionType: "conflicting_info",
        sourceTypes: ["jira"],
        maximumDocuments: 2,
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

  it("selects the strongest document from each requested source before filling extras", () => {
    const ranked = rankCandidateDocuments(
      {
        questionId: "qst_source_diversity",
        question: "What deterministic decoding settings must the eval runner enforce?",
        questionType: "conflicting_info",
        sourceTypes: ["confluence", "slack"],
        maximumDocuments: 2,
      },
      [
        { sourceObjectId: "confluence-best", sourceNativeId: "c1", sourceSystem: "confluence", title: "Eval runner deterministic decoding", body: "temperature and sampling controls", payloadDigest: "1" },
        { sourceObjectId: "confluence-second", sourceNativeId: "c2", sourceSystem: "confluence", title: "Eval runner settings", body: "deterministic runner", payloadDigest: "2" },
        { sourceObjectId: "slack-best", sourceNativeId: "s1", sourceSystem: "slack", title: "eng-ml", body: "deterministic decoding settings for the eval runner", payloadDigest: "3" },
      ],
      2,
    );
    expect(ranked.map((item) => item.sourceObjectId).sort()).toEqual([
      "confluence-best",
      "slack-best",
    ]);
  });
});
