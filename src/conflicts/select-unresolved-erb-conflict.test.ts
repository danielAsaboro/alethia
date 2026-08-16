import { describe, expect, it } from "vitest";

import {
  promoteAcceptedConflict,
  type AcceptedConflictExtraction,
} from "./promote-erb-conflict";
import { selectUnresolvedConflictSeed } from "./select-unresolved-erb-conflict";

function extraction(
  cacheKey: string,
  sourceObjectId: string,
  sourceNativeId: string,
  sourceSystem: string,
  value: string,
  quote: string,
): AcceptedConflictExtraction {
  return {
    cacheKey,
    status: "accepted",
    sourceObjectId,
    sourceNativeId,
    sourceSystem,
    sourceDigest: `digest-${cacheKey}`,
    observation: {
      subject: "tool-signal",
      predicate: "conflict_answer",
      value,
      evidenceQuote: quote,
      lifecycle: "applied",
    },
  };
}

describe("selectUnresolvedConflictSeed", () => {
  it("accepts two grounded contradictory values with equal lifecycle and no winner", () => {
    const promoted = promoteAcceptedConflict({
      questionId: "qst_unresolved",
      question: "Is a public request flag required?",
      accepted: [
        extraction("a", "source-a", "doc-a", "github", "public request flag is required", "The public request flag is required."),
        extraction("b", "source-b", "doc-b", "google_drive", "no public request flag", "There is no public request flag."),
      ],
    });

    const seed = selectUnresolvedConflictSeed([promoted], "qst_unresolved");

    expect(seed).toMatchObject({
      questionId: "qst_unresolved",
      resolution: "unresolved",
      resolutionReason: "equal_lifecycle_without_authority",
    });
    expect(seed.values).toEqual(["public request flag is required", "no public request flag"]);
    expect(seed.evidence).toHaveLength(2);
    expect(seed.policyId).toBeUndefined();
    expect(seed.winningClaimId).toBeUndefined();
  });

  it("rejects a case with a winner or policy", () => {
    const promoted = promoteAcceptedConflict({
      questionId: "qst_resolved",
      question: "What value applies?",
      accepted: [
        {
          ...extraction("a", "source-a", "doc-a", "drive", "new", "The applied value is new."),
          observation: { subject: "tool-signal", predicate: "conflict_answer", value: "new", evidenceQuote: "The applied value is new.", lifecycle: "applied" },
        },
        {
          ...extraction("b", "source-b", "doc-b", "jira", "old", "The proposal was old."),
          observation: { subject: "tool-signal", predicate: "conflict_answer", value: "old", evidenceQuote: "The proposal was old.", lifecycle: "proposal" },
        },
      ],
    });

    expect(() => selectUnresolvedConflictSeed([promoted], "qst_resolved")).toThrow(/unresolved/);
  });
});
