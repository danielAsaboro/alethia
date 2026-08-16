import { describe, expect, it } from "vitest";
import { listJudgeCases } from "./case-registry";

describe("judge case registry", () => {
  it("contains the runtime-safe enterprise truth lanes including a distinct disputed case", () => {
    const cases = listJudgeCases();
    expect(cases).toHaveLength(9);
    expect(cases.map((item) => item.id)).toEqual([
      "streamly-credit-conflict",
      "handshake-ttl-conflict",
      "tool-signal-disputed",
      "owner-is-not-owner",
      "david-taylor-collision",
      "favorite-lunch-boundary",
      "charlie-davis-role",
      "actiongenie-team",
      "charlie-davis-lagos",
    ]);
    expect([...new Set(cases.map((item) => item.kind))].sort()).toEqual([
      "alignment",
      "conflict",
      "identity",
      "knowledge_boundary",
      "multi_hop",
      "simple_lookup",
    ]);
    const serialized = JSON.stringify(cases);
    expect(serialized).not.toMatch(/gold_answer|answer_facts|expected_doc_ids/);
    expect(serialized).not.toMatch(/entityLogicalId|predicateFamily/);
    expect(serialized).not.toMatch(/30%|20%|120 seconds|180-second|Software Engineer|66 team members/);
  });
});
