import { describe, expect, it } from "vitest";
import { buildAlignmentAudit } from "./build-audit";

const records = [
  { id: "drive", sourceSystem: "google_drive", sourceObjectType: "document", sourceNativeId: "d1", sourcePath: "x", contentScope: "body" as const, payloadDigest: "a", fields: {}, identities: [] },
  { id: "hub", sourceSystem: "hubspot", sourceObjectType: "document", sourceNativeId: "h1", sourcePath: "x", contentScope: "body" as const, payloadDigest: "b", fields: {}, identities: [] },
];

describe("buildAlignmentAudit", () => {
  it("beats field-name alignment and retains rejected candidates", () => {
    const audit = buildAlignmentAudit(records, [
      { questionId: "q1", documentId: "d1", sourceSystem: "google_drive", objectType: "document", surface: "owner", contextualRole: "file_metadata" },
      { questionId: "q2", documentId: "h1", sourceSystem: "hubspot", objectType: "opportunity", surface: "owner", contextualRole: "sales_opportunity" },
    ]);
    expect(audit.baseline.map((row) => row.naiveMapping)).toEqual(["OWNS", "OWNS"]);
    expect(audit.baseline.map((row) => row.acceptedMapping).sort()).toEqual(["FILE_OWNER", "OPPORTUNITY_OWNER"]);
    expect(audit.decisions.filter((decision) => decision.status === "rejected")).toHaveLength(2);
  });
});
