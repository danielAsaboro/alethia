import { describe, expect, it } from "vitest";

import {
  buildGroundingCandidates,
  validateConflictObservation,
  validateConflictSelection,
} from "./conflict-extraction";

const sourceText =
  "The applied configuration will reserve 30% of interactive burst credits exclusively for priority=high routes.";

describe("validateConflictObservation", () => {
  it("accepts an exact-quote-grounded lifecycle observation", () => {
    expect(
      validateConflictObservation({
        responseText: JSON.stringify({
          subject: "dp-132-usw",
          predicate: "Reserved High Priority Burst Credit Percent",
          value: 30,
          evidenceQuote:
            "reserve 30% of interactive burst credits exclusively for priority=high routes",
          lifecycle: "applied",
        }),
        sourceText,
      }),
    ).toMatchObject({
      value: 30,
      predicate: "reserved_high_priority_burst_credit_percent",
      lifecycle: "applied",
    });
  });

  it.each([
    {
      name: "invented quote",
      body: {
        subject: "dp-132-usw",
        predicate: "reserved_percent",
        value: 30,
        evidenceQuote: "30% is already live in production",
        lifecycle: "applied",
      },
    },
    {
      name: "empty subject",
      body: {
        subject: "",
        predicate: "reserved_percent",
        value: 30,
        evidenceQuote: "reserve 30%",
        lifecycle: "applied",
      },
    },
    {
      name: "value absent from quote",
      body: {
        subject: "dp-132-usw",
        predicate: "reserved_percent",
        value: 20,
        evidenceQuote: "reserve 30%",
        lifecycle: "applied",
      },
    },
    {
      name: "evaluation label leakage",
      body: {
        subject: "dp-132-usw",
        predicate: "reserved_percent",
        value: 30,
        evidenceQuote: "reserve 30%",
        lifecycle: "applied",
        gold_answer: "30%",
      },
    },
  ])("rejects $name", ({ body }) => {
    expect(() =>
      validateConflictObservation({
        responseText: JSON.stringify(body),
        sourceText,
      }),
    ).toThrow();
  });
});

describe("constrained conflict evidence selection", () => {
  it("turns a selected exact source candidate into a grounded observation", () => {
    const body = [
      "Unrelated operational note.",
      "An earlier proposal reserved 20% of burst credits for priority=high routes on dp-132-usw.",
      "The applied configuration now reserves 30% of burst credits for priority=high routes on dp-132-usw.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question:
        "What burst credit percentage applies to priority=high routes on dp-132-usw?",
      sourceText: body,
      limit: 8,
    });
    const applied = candidates.find((candidate) =>
      candidate.quote.includes("30%"),
    );
    if (!applied) throw new Error("Expected applied source candidate");

    expect(
      validateConflictSelection({
        responseText: JSON.stringify({
          candidateIndex: applied.index,
          value: "30%",
          lifecycle: "applied",
        }),
        candidates,
        sourceText: body,
        subject: "dp-132-usw",
        predicate: "conflict_answer",
      }),
    ).toMatchObject({
      value: "30%",
      lifecycle: "applied",
      evidenceQuote: applied.quote,
    });
    expect(candidates.every((candidate) => /%|percent/i.test(candidate.quote))).toBe(
      true,
    );
  });

  it("rejects an out-of-range candidate or a value absent from the candidate", () => {
    const candidates = [{ index: 0, quote: "The applied target is 30%." }];
    expect(() =>
      validateConflictSelection({
        responseText:
          '{"candidateIndex":0,"value":"20%","lifecycle":"applied"}',
        candidates,
        sourceText: candidates[0].quote,
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toThrow("value is not in its quote");
    expect(() =>
      validateConflictSelection({
        responseText:
          '{"candidateIndex":9,"value":"30%","lifecycle":"applied"}',
        candidates,
        sourceText: candidates[0].quote,
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toThrow("candidate does not exist");
  });

  it("rejects truncated model JSON without recovering a partial success", () => {
    expect(() =>
      validateConflictSelection({
        responseText: '{"candidateIndex":0,"value":"30%"',
        candidates: [{ index: 0, quote: "The applied target is 30%." }],
        sourceText: "The applied target is 30%.",
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toThrow(/valid JSON/i);
  });

  it("normalizes a single percentage from a selected quote and classifies lifecycle", () => {
    const candidates = [
      {
        index: 0,
        quote:
          "Short-term recommendation: reserve 20% of burst credits for priority routes.",
      },
    ];
    expect(
      validateConflictSelection({
        responseText: JSON.stringify({
          candidateIndex: 0,
          value: candidates[0].quote,
        }),
        candidates,
        sourceText: candidates[0].quote,
        question: "What % of burst credits should be reserved?",
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toMatchObject({ value: "20%", lifecycle: "proposal" });
  });

  it("treats an updated target as applied despite a model lifecycle proposal", () => {
    const candidates = [
      {
        index: 0,
        quote:
          "Updated reservation target: reserve 30% (previous suggestion was 20%).",
      },
    ];
    expect(
      validateConflictSelection({
        responseText:
          '{"candidateIndex":0,"value":"30%","lifecycle":"proposal"}',
        candidates,
        sourceText: candidates[0].quote,
        question: "What % is reserved?",
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toMatchObject({ value: "30%", lifecycle: "applied" });
  });
});
