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
  it("offers bounded adjacent source lines so a heading retains its required settings", () => {
    const sourceText = [
      "When deterministic mode is enabled, enforce these decoding settings:",
      "- temperature=0 and top_p=1",
      "- disable sampling and pin the random seed",
      "Unrelated appendix.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What deterministic decoding settings must be enforced?",
      sourceText,
      limit: 12,
    });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        quote: expect.stringMatching(/deterministic mode[\s\S]*temperature=0[\s\S]*disable sampling/i),
      }),
    ]));
    expect(candidates.every((item) => item.quote.length <= 7000)).toBe(true);
    expect(candidates.every((item) => sourceText.includes(item.quote))).toBe(true);
  });

  it("offers a complete structured list while keeping the total prompt budget bounded", () => {
    const sourceText = [
      "Current deterministic decoding settings:",
      "- do_sample=false",
      "- temperature=0",
      "- top_k=0",
      "- top_p=1",
      "- num_beams=1",
      "- use an explicit generator",
      "- preserve stable ordering",
      "Appendix: unrelated implementation notes.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What deterministic decoding settings must be enforced?",
      sourceText,
      limit: 8,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        quote: expect.stringMatching(/do_sample=false[\s\S]*stable ordering/),
      }),
    ]));
    expect(candidates.reduce((total, item) => total + item.quote.length, 0)).toBeLessThanOrEqual(10_000);
    expect(candidates.every((item) => sourceText.includes(item.quote))).toBe(true);
  });

  it("ranks question overlap above an unrelated longer list", () => {
    const sourceText = [
      "Operational backup manifest checklist:",
      "- rotate KMS keys",
      "- verify signed restore reports",
      "- archive signed manifests",
      "- test retention",
      "",
      "Background note one.",
      "Background note two.",
      "Background note three.",
      "Background note four.",
      "Background note five.",
      "Background note six.",
      "Background note seven.",
      "Background note eight.",
      "",
      "Integrity and tamper evidence:",
      "- As of v1.8+, manifests can be signed using cosign in offline mode.",
      "- GPG is supported only for migration.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What is recommended for signing backup manifests?",
      sourceText,
      limit: 8,
    });

    expect(candidates[0]?.quote).toMatch(/v1\.8[\s\S]*cosign/i);
  });

  it("diversifies overlapping windows so a later answer section is retained", () => {
    const sourceText = [
      "Current prompt bucket dashboard overview:",
      "- short series is displayed",
      "- medium series is displayed",
      "- long series is displayed",
      "- current routes are filterable",
      "- prompt metrics are charted",
      "- bucket labels are visible",
      "- cutoff annotations are supported",
      "",
      "Unrelated separator one.",
      "Unrelated separator two.",
      "Unrelated separator three.",
      "Unrelated separator four.",
      "Unrelated separator five.",
      "Unrelated separator six.",
      "Unrelated separator seven.",
      "Unrelated separator eight.",
      "",
      "Current prompt_len_bucket cutoffs:",
      "- short: fewer than 128 tokens",
      "- medium: 128 through 1024 tokens",
      "- long: more than 1024 tokens",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What are the current prompt bucket cutoffs for short, medium, and long?",
      sourceText,
      limit: 4,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ quote: expect.stringMatching(/fewer than 128[\s\S]*more than 1024/) }),
    ]));
  });

  it("prioritizes numeric threshold blocks for score-range questions", () => {
    const sourceText = [
      "Tier score ranges overview:",
      "- Tier 1 means widespread impact",
      "- Tier 2 means major impact",
      "- Tier 3 means localized impact",
      "- Tier 4 means minor impact",
      "",
      "Background one.",
      "Background two.",
      "Background three.",
      "Background four.",
      "Background five.",
      "Background six.",
      "Background seven.",
      "Background eight.",
      "",
      "Current v2 score thresholds:",
      "- Tier 1: score >= 85",
      "- Tier 2: score 70-84",
      "- Tier 3: score 50-69",
      "- Tier 4: score < 50",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What score ranges map to Tiers 1-4 in v2?",
      sourceText,
      limit: 4,
    });

    expect(candidates[0]?.quote).toMatch(/>= 85[\s\S]*70-84[\s\S]*50-69[\s\S]*< 50/);
  });

  it("prioritizes the rate together with its explicit measurement basis", () => {
    const sourceText = [
      "Current measurement basis:",
      "- Use provider-billed GiB for cross-region egress.",
      "- Attribute egress to request traces using sampled bytes, not token counts.",
      ...Array.from({ length: 30 }, (_, index) => `Operational detail ${index + 1}.`),
      "Current catalog row:",
      "- Rate is $0.085 per GiB; expected impact is $160-$260 per hour at 1000 rps.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What egress cost rate and measurement basis does the catalog use?",
      sourceText,
      limit: 4,
    });

    expect(candidates[0]?.quote).toMatch(
      /provider-billed GiB[\s\S]*sampled bytes[\s\S]*160-\$260/i,
    );
  });

  it("prioritizes exact identifier syntax for format questions", () => {
    const sourceText = [
      "Final weekly delivery: Tuesdays by 07:00 PT.",
      ...Array.from({ length: 12 }, (_, index) => `Invoice cadence detail ${index + 1}.`),
      "Final po_fingerprint format:",
      "- Hash the exact string PO_NUMBER|PO_LINE_UUID with no whitespace.",
      "- Emit the lowercase SHA-256 hex digest on every invoice line.",
    ].join("\n");
    const candidates = buildGroundingCandidates({
      question: "What is the final po_fingerprint format and weekly delivery time?",
      sourceText,
      limit: 4,
    });

    expect(candidates[0]?.quote).toMatch(/PO_NUMBER\|PO_LINE_UUID[\s\S]*no whitespace/i);
    expect(candidates[0]?.quote).toMatch(/lowercase SHA-256 hex digest/i);
    expect(candidates[0]?.quote).toMatch(/07:00 PT/i);
  });

  it("preserves literal escaped newlines while building structured candidates", () => {
    const sourceText = [
      "Current v2 thresholds:",
      "Tier 1 >= 85",
      "Tier 2 70-84",
      "Tier 3 35-69",
      "Tier 4 < 35",
      "Previous thresholds:",
      "Tier 1 >= 90",
      "Tier 2 75-89",
      "Tier 3 40-74",
      "Tier 4 < 40",
    ].join("\\n");
    const candidates = buildGroundingCandidates({
      question: "What score ranges map to tiers in v2 and the previous thresholds?",
      sourceText,
      limit: 4,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ quote: expect.stringMatching(/>= 85\\nTier 2 70-84/) }),
      expect.objectContaining({ quote: expect.stringMatching(/>= 90\\nTier 2 75-89/) }),
    ]));
    expect(candidates.every((item) => sourceText.includes(item.quote))).toBe(true);
  });

  it("treats literal escaped newlines as boundaries instead of selecting a whole serialized thread", () => {
    const sourceText = [
      "Earlier negotiation thread:",
      ...Array.from({ length: 25 }, (_, index) => `Unrelated commercial note ${index + 1}.`),
      "Set po_fingerprint to raw PO#|LINEUUID with no hashing.",
      "Deliver weekly invoices Monday 08:00 PT.",
      ...Array.from({ length: 25 }, (_, index) => `Unrelated appendix ${index + 1}.`),
    ].join("\\n");
    const candidates = buildGroundingCandidates({
      question: "What po_fingerprint format and weekly invoice delivery time were proposed?",
      sourceText,
      limit: 4,
    });

    expect(candidates[0]?.quote).toMatch(/PO#\|LINEUUID[\s\S]*Monday 08:00 PT/i);
    expect(candidates[0]!.quote.length).toBeLessThan(sourceText.length / 2);
    expect(candidates.every((item) => sourceText.includes(item.quote))).toBe(true);
  });

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

  it("falls back to the exact candidate when the model value is not contiguous", () => {
    const candidates = [{ index: 0, quote: "The applied target is 30%." }];
    expect(
      validateConflictSelection({
        responseText:
          '{"candidateIndex":0,"value":"20%","lifecycle":"applied"}',
        candidates,
        sourceText: candidates[0].quote,
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toMatchObject({ value: candidates[0].quote, evidenceQuote: candidates[0].quote });
  });

  it("rejects an out-of-range candidate", () => {
    const candidates = [{ index: 0, quote: "The applied target is 30%." }];
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

  it("recovers a unique valid candidate index from truncated model JSON", () => {
    expect(
      validateConflictSelection({
        responseText: '{"candidateIndex":0,"value":"The applied target is 30%',
        candidates: [{ index: 0, quote: "The applied target is 30%." }],
        sourceText: "The applied target is 30%.",
        question: "What % is the applied target?",
        subject: "pool",
        predicate: "conflict_answer",
      }),
    ).toMatchObject({ value: "30%", evidenceQuote: "The applied target is 30%." });
  });

  it("rejects truncated JSON with an ambiguous or nonexistent candidate index", () => {
    const input = {
      candidates: [{ index: 0, quote: "The applied target is 30%." }],
      sourceText: "The applied target is 30%.",
      subject: "pool",
      predicate: "conflict_answer",
    };
    expect(() =>
      validateConflictSelection({
        ...input,
        responseText: '{"candidateIndex":0,"candidateIndex":1,"value":"',
      }),
    ).toThrow(/valid JSON/i);
    expect(() =>
      validateConflictSelection({
        ...input,
        responseText: '{"candidateIndex":9,"value":"',
      }),
    ).toThrow(/candidate does not exist/i);
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
