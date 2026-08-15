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
    sourceTitle: "Current reference",
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

  it("normalizes a percentage answer from a grounded explanatory value", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_percentage",
      question: "What % of credits should be reserved?",
      accepted: [
        extraction({
          cacheKey: "current",
          sourceObjectId: "src-current",
          sourceNativeId: "current",
          observation: {
            subject: "pool",
            predicate: "conflict_answer",
            value: "Updated target: reserve 30% (previous suggestion was 20%).",
            evidenceQuote: "Updated target: reserve 30% (previous suggestion was 20%).",
            lifecycle: "applied",
          },
        }),
        extraction({
          cacheKey: "proposal",
          sourceObjectId: "src-proposal",
          sourceNativeId: "proposal",
          observation: {
            subject: "pool",
            predicate: "conflict_answer",
            value: "20%",
            evidenceQuote: "Proposal: reserve 20%.",
            lifecycle: "proposal",
          },
        }),
      ],
    });

    expect(result).toMatchObject({ status: "resolved", winningValue: "30%" });
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

  it("resolves an explicitly corrected source over the superseded report", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_correction",
      question: "What caused the incident?",
      accepted: [
        extraction({
          cacheKey: "corrected",
          sourceObjectId: "src-new",
          sourceNativeId: "new",
          sourceTitle: "Incident correction after telemetry review",
          observation: { subject: "incident", predicate: "conflict_answer", value: "driver stalls", evidenceQuote: "Correction after deeper telemetry review: the issue was driver stalls, not OOM.", lifecycle: "applied" },
        }),
        extraction({
          cacheKey: "old",
          sourceObjectId: "src-old",
          sourceNativeId: "old",
          sourceTitle: "Initial incident report",
          observation: { subject: "incident", predicate: "conflict_answer", value: "OOM", evidenceQuote: "Initial report: the issue was OOM.", lifecycle: "applied" },
        }),
      ],
    });
    expect(result).toMatchObject({
      status: "resolved",
      winningValue: "driver stalls",
      conflict: { resolution: "left", policyId: "policy_grounded_supersession_v2" },
    });
  });

  it("uses post-merge current guidance over an earlier same-lifecycle spec", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_post_merge",
      question: "Is the flag exposed?",
      accepted: [
        extraction({
          cacheKey: "old-spec",
          sourceObjectId: "src-old",
          sourceNativeId: "old",
          sourceTitle: "API v9 design",
          observation: { subject: "api", predicate: "conflict_answer", value: "flag required", evidenceQuote: "Callers include the flag.", lifecycle: "applied" },
        }),
        extraction({
          cacheKey: "post-merge",
          sourceObjectId: "src-new",
          sourceNativeId: "new",
          sourceTitle: "API v9 post-merge notes",
          observation: { subject: "api", predicate: "conflict_answer", value: "no public flag", evidenceQuote: "There is no per-request public flag.", lifecycle: "applied" },
        }),
      ],
    });
    expect(result).toMatchObject({
      status: "resolved",
      winningValue: "no public flag",
      conflict: { resolution: "right", policyId: "policy_grounded_supersession_v2" },
    });
  });

  it("uses the newer grounded ISO date when the question asks for the latest value", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_latest",
      question: "What is the latest baseline QPS?",
      accepted: [
        extraction({
          cacheKey: "newer",
          sourceObjectId: "src-newer",
          sourceNativeId: "newer",
          observation: {
            subject: "customer",
            predicate: "conflict_answer",
            value: "60 QPS",
            evidenceQuote: "Latest projection from 2026-03-12: baseline 60 QPS.",
            lifecycle: "applied",
          },
        }),
        extraction({
          cacheKey: "older",
          sourceObjectId: "src-older",
          sourceNativeId: "older",
          observation: {
            subject: "customer",
            predicate: "conflict_answer",
            value: "50 QPS",
            evidenceQuote: "Workshop notes from 2026-03-01: baseline 50 QPS.",
            lifecycle: "applied",
          },
        }),
      ],
    });

    expect(result).toMatchObject({
      status: "resolved",
      winningValue: "60 QPS",
      conflict: { resolution: "left", policyId: "policy_grounded_supersession_v2" },
    });
  });

  it("prefers an explicit latest marker when the older source has no date", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_latest_marker",
      question: "What is the latest baseline QPS?",
      accepted: [
        extraction({
          cacheKey: "latest",
          sourceObjectId: "src-latest",
          sourceNativeId: "latest",
          observation: {
            subject: "customer",
            predicate: "conflict_answer",
            value: "60 QPS",
            evidenceQuote: "Latest projection from 2026-03-12: baseline 60 QPS.",
            lifecycle: "applied",
          },
        }),
        extraction({
          cacheKey: "current-old",
          sourceObjectId: "src-current-old",
          sourceNativeId: "current-old",
          observation: {
            subject: "customer",
            predicate: "conflict_answer",
            value: "50 QPS",
            evidenceQuote: "Current production-ish load: baseline 50 QPS.",
            lifecycle: "applied",
          },
        }),
      ],
    });

    expect(result).toMatchObject({ status: "resolved", winningValue: "60 QPS" });
  });

  it("does not treat an incidental 'was' phrase as supersession", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_ttl",
      question: "What is the default handshake TTL?",
      accepted: [
        extraction({
          cacheKey: "new-ttl",
          sourceObjectId: "src-new-ttl",
          sourceNativeId: "new-ttl",
          sourceTitle: "GPU handoff runbook (2025)",
          observation: {
            subject: "handoff",
            predicate: "conflict_answer",
            value: "120 seconds",
            evidenceQuote: "Handshake tokens now default to 120 seconds (was 180s).",
            lifecycle: "applied",
          },
        }),
        extraction({
          cacheKey: "old-ttl",
          sourceObjectId: "src-old-ttl",
          sourceNativeId: "old-ttl",
          observation: {
            subject: "handoff",
            predicate: "conflict_answer",
            value: "180 seconds",
            evidenceQuote: "The incident was non-trivial. Handshake tokens default to 180 seconds.",
            lifecycle: "applied",
          },
        }),
      ],
    });

    expect(result).toMatchObject({ status: "resolved", winningValue: "120 seconds" });
  });

  it("prefers the claim that asserts a queried duration over a version that replaces it", () => {
    const result = promoteAcceptedConflict({
      questionId: "qst_duration_snapshot",
      question: "Who approves termination after the 72h grace window?",
      accepted: [
        extraction({
          cacheKey: "asserted",
          sourceObjectId: "src-asserted",
          sourceNativeId: "ticket-42",
          observation: {
            subject: "cleanup",
            predicate: "conflict_answer",
            value: "cost-ops",
            evidenceQuote: "Can we get infra approval after 72h? Cost-ops approves termination after the grace window.",
            lifecycle: "applied",
          },
        }),
        extraction({
          cacheKey: "replaced",
          sourceObjectId: "src-replaced",
          sourceNativeId: "ticket-42",
          observation: {
            subject: "cleanup",
            predicate: "conflict_answer",
            value: "infra manager",
            evidenceQuote: "Use five business days, updated from 72h. The final rule is not 72h.",
            lifecycle: "applied",
          },
        }),
      ],
    });

    expect(result).toMatchObject({ status: "resolved", winningValue: "cost-ops" });
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
