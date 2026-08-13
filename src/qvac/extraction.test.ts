import { describe, expect, it } from "vitest";

import { validateQvacExtraction } from "./extraction";
import { mapQvacClaimToGraph } from "./client";

describe("validateQvacExtraction", () => {
  it("accepts fenced JSON only when predicates and quotes are grounded", () => {
    expect(
      validateQvacExtraction({
        responseText:
          '```json\n{"claims":[{"predicate":"has_role","value":"Software Engineer","evidenceQuote":"works as Software Engineer"}]}\n```',
        sourceText:
          "HERB employee record: Charlie Davis works as Software Engineer. Location: Remote.",
        allowedPredicates: ["has_role", "located_in"],
      }),
    ).toEqual([
      {
        predicate: "has_role",
        value: "Software Engineer",
        evidenceQuote: "works as Software Engineer",
      },
    ]);
  });

  it("rejects unsupported predicates and invented evidence", () => {
    expect(() =>
      validateQvacExtraction({
        responseText:
          '{"claims":[{"predicate":"salary","value":"100000","evidenceQuote":"salary is 100000"}]}',
        sourceText: "Charlie Davis works as Software Engineer.",
        allowedPredicates: ["has_role"],
      }),
    ).toThrow("QVAC extraction failed grounding validation");
  });
});

describe("mapQvacClaimToGraph", () => {
  it("preserves QVAC grounding in the Hydra claim path", () => {
    const graph = mapQvacClaimToGraph(
      {
        id: "claim_qvac",
        subjectEntityId: "entity_person",
        predicate: "has_role",
        object: { kind: "literal", value: "Software Engineer" },
        sourceObjectId: "source_herb",
        sourceSystem: "herb",
        extractionMethod: "qvac",
        extractorVersion: "qvac:test",
      },
      "works as Software Engineer",
    );

    expect(graph.nodes).toEqual([
      expect.objectContaining({
        logicalId: "claim_qvac",
        label: "Claim",
        properties: expect.objectContaining({
          extractionMethod: "qvac",
          evidenceQuote: "works as Software Engineer",
        }),
      }),
    ]);
    expect(graph.edges.map((edge) => edge.type).sort()).toEqual([
      "ASSERTS",
      "SUPPORTED_BY",
    ]);
  });
});
