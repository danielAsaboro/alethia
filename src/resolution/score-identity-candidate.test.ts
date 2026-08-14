import { describe, expect, it } from "vitest";
import { scoreIdentityCandidate } from "./score-identity-candidate";

describe("scoreIdentityCandidate", () => {
  it("accepts verified linkage despite different display names", () => {
    expect(scoreIdentityCandidate({
      candidateSourceObjectIds: ["gmail_sam", "slack_soham"],
      signals: [
        { kind: "verified_email_exact", value: "soham@example.com", weight: 1 },
        { kind: "verified_account_link", value: "gmail_sam->@soham", weight: 1 },
      ],
      constraints: [],
    })).toMatchObject({ status: "accepted", score: 1 });
  });

  it("rejects similarity when verified identities conflict", () => {
    expect(scoreIdentityCandidate({
      candidateSourceObjectIds: ["hr_sam_1", "hr_sam_2"],
      signals: [{ kind: "name_similarity", value: "sam ratnaparkhi", weight: 0.96 }],
      constraints: [
        { kind: "verified_email_conflict", leftValue: "sam@a.com", rightValue: "sam@b.com" },
        { kind: "employee_id_conflict", leftValue: "E-1", rightValue: "E-2" },
      ],
    })).toMatchObject({ status: "rejected", score: 0 });
  });

  it("leaves name and neighborhood evidence pending", () => {
    expect(scoreIdentityCandidate({
      candidateSourceObjectIds: ["a", "b"],
      signals: [
        { kind: "name_similarity", value: "sam", weight: 0.9 },
        { kind: "neighborhood_overlap", value: "team-platform", weight: 0.7 },
      ],
      constraints: [],
    })).toMatchObject({ status: "pending" });
  });
});
