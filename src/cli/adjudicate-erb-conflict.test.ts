import { describe, expect, it } from "vitest";

import { promoteAcceptedConflict } from "@/conflicts/promote-erb-conflict";
import {
  graphForPromotion,
  parseAdjudicateErbConflictArgs,
} from "./adjudicate-erb-conflict";

describe("parseAdjudicateErbConflictArgs", () => {
  it("requires explicit extraction evidence and dossier output", () => {
    expect(
      parseAdjudicateErbConflictArgs([
        "--extractions",
        "../submission/evidence/qvac/erb-conflicts.json",
        "--output",
        "../submission/evidence/cases/qst_0411.json",
      ]),
    ).toEqual({
      extractions: "../submission/evidence/qvac/erb-conflicts.json",
      output: "../submission/evidence/cases/qst_0411.json",
    });
  });

  it("rejects implicit paths", () => {
    expect(() => parseAdjudicateErbConflictArgs([])).toThrow(
      "Usage: npm run adjudicate:erb-conflict",
    );
  });

  it("does not fabricate an authority policy for an unresolved conflict", () => {
    const promoted = promoteAcceptedConflict({
      questionId: "qst_unresolved",
      question: "Which mode is enabled?",
      accepted: [
        {
          cacheKey: "a".repeat(64),
          status: "accepted",
          sourceObjectId: "source_a",
          sourceSystem: "github",
          sourceNativeId: "doc_a",
          sourceDigest: "a".repeat(64),
          observation: {
            subject: "example bridge",
            predicate: "mode",
            value: "alpha",
            evidenceQuote: "The mode is alpha.",
            lifecycle: "unknown",
          },
        },
        {
          cacheKey: "b".repeat(64),
          status: "accepted",
          sourceObjectId: "source_b",
          sourceSystem: "google_drive",
          sourceNativeId: "doc_b",
          sourceDigest: "b".repeat(64),
          observation: {
            subject: "example bridge",
            predicate: "mode",
            value: "beta",
            evidenceQuote: "The mode is beta.",
            lifecycle: "unknown",
          },
        },
      ],
    });
    expect(promoted.status).toBe("unresolved");
    if (promoted.status === "skipped") throw new Error(promoted.reason);

    const graph = graphForPromotion(promoted);

    expect(graph.nodes.filter((node) => node.label === "AuthorityPolicy")).toEqual([]);
    expect(graph.edges.filter((edge) => edge.type === "DECIDED_BY")).toEqual([]);
  });
});
