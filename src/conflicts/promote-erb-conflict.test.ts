import { describe, expect, it } from "vitest";

import {
  promoteAcceptedConflict,
  type AcceptedConflictExtraction,
} from "./promote-erb-conflict";

function extraction(
  overrides: Partial<AcceptedConflictExtraction> & Pick<AcceptedConflictExtraction, "cacheKey" | "sourceObjectId" | "sourceNativeId" | "observation">,
): AcceptedConflictExtraction {
  return {
    status: "accepted",
    sourceSystem: "confluence",
    sourceDigest: "digest",
    ...overrides,
  };
}

describe("promoteAcceptedConflict", () => {
  it("resolves an applied claim over a proposal", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_0411",
      question: "What percentage is reserved?",
      accepted: [
        extraction({
          cacheKey: "a",
          sourceObjectId: "src_drive",
          sourceNativeId: "drive-1",
          sourceSystem: "google_drive",
          observation: { subject: "dp-132-usw", predicate: "conflict_answer", value: "30%", evidenceQuote: "reserve 30%", lifecycle: "applied" },
        }),
        extraction({
          cacheKey: "b",
          sourceObjectId: "src_jira",
          sourceNativeId: "jira-1",
          sourceSystem: "jira",
          observation: { subject: "dp-132-usw", predicate: "conflict_answer", value: "20%", evidenceQuote: "adjust 20%", lifecycle: "proposal" },
        }),
      ],
    });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.winningValue).toBe("30%");
    expect(result.conflict.resolution).toBe("left");
  });

  it("leaves a contradiction unresolved when both lifecycles are unknown", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_0421",
      question: "Default TTL?",
      accepted: [
        extraction({
          cacheKey: "c",
          sourceObjectId: "src_a",
          sourceNativeId: "doc-a",
          observation: { subject: "qst_0421", predicate: "conflict_answer", value: "120 seconds", evidenceQuote: "TTL 120 seconds", lifecycle: "unknown" },
        }),
        extraction({
          cacheKey: "d",
          sourceObjectId: "src_b",
          sourceNativeId: "doc-b",
          observation: { subject: "qst_0421", predicate: "conflict_answer", value: "180 seconds", evidenceQuote: "TTL-limited (default 180s)", lifecycle: "unknown" },
        }),
      ],
    });
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") throw new Error("expected unresolved");
    expect(result.conflict.resolution).toBe("unresolved");
    expect(result.losingClaimIds).toEqual([]);
  });

  it("uses stable graph identities for the unresolved qst_0421-shaped case", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_0421",
      question: "Default TTL?",
      accepted: [
        extraction({
          cacheKey: "c",
          sourceObjectId: "src_a",
          sourceNativeId: "doc-a",
          sourceDigest: "digest-a",
          observation: { subject: "qst_0421", predicate: "conflict_answer", value: "120 seconds", evidenceQuote: "TTL 120 seconds", lifecycle: "unknown" },
        }),
        extraction({
          cacheKey: "d",
          sourceObjectId: "src_b",
          sourceNativeId: "doc-b",
          sourceSystem: "google_drive",
          sourceDigest: "digest-b",
          observation: { subject: "qst_0421", predicate: "conflict_answer", value: "180 seconds", evidenceQuote: "TTL-limited (default 180s)", lifecycle: "unknown" },
        }),
      ],
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "skipped") throw new Error("expected promoted conflict");
    expect(result.subjectEntityId).toBe("entity_bbbccb0c3d43286a9836f543");
    expect(result.conflict.id).toBe("conflict_d74998996e05adae1f8ea4cd");
  });

  it("skips observations about different subjects instead of creating a cross-entity conflict", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_cross_entity",
      question: "What is the default TTL?",
      accepted: [
        extraction({
          cacheKey: "left",
          sourceObjectId: "src_left",
          sourceNativeId: "left",
          observation: { subject: "warm-pool-a", predicate: "conflict_answer", value: "120 seconds", evidenceQuote: "pool A TTL is 120 seconds", lifecycle: "unknown" },
        }),
        extraction({
          cacheKey: "right",
          sourceObjectId: "src_right",
          sourceNativeId: "right",
          observation: { subject: "warm-pool-b", predicate: "conflict_answer", value: "180 seconds", evidenceQuote: "pool B TTL is 180 seconds", lifecycle: "unknown" },
        }),
      ],
    });

    expect(result).toEqual({
      status: "skipped",
      questionId: "qst_cross_entity",
      reason: "subject_mismatch",
    });
  });

  it("skips cases without two accepted observations", () => {
    expect(
      promoteAcceptedConflict({
        questionId: "qst_x",
        question: "q",
        accepted: [
          extraction({
            cacheKey: "only",
            sourceObjectId: "src",
            sourceNativeId: "n",
            observation: { subject: "s", predicate: "conflict_answer", value: "1", evidenceQuote: "q", lifecycle: "applied" },
          }),
        ],
      }).status,
    ).toBe("skipped");
  });
});
