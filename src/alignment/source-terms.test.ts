import { describe, expect, it } from "vitest";

import {
  createSourceSchemaTerm,
  naiveFieldNameAlignment,
} from "./source-terms";

describe("source schema terms", () => {
  it("keeps identical owner surfaces distinct across source contexts", () => {
    const driveOwner = createSourceSchemaTerm({
      sourceSystem: "google_drive",
      objectType: "document",
      surface: "owner",
      contextualRole: "file_metadata",
    });
    const hubspotOwner = createSourceSchemaTerm({
      sourceSystem: "hubspot",
      objectType: "account",
      surface: "owner",
      contextualRole: "sales_account",
    });

    expect(driveOwner.id).not.toBe(hubspotOwner.id);
    expect(driveOwner).toMatchObject({ canonicalHint: "FILE_OWNER" });
    expect(hubspotOwner).toMatchObject({ canonicalHint: "ACCOUNT_OWNER" });
    expect(naiveFieldNameAlignment(driveOwner)).toBe("OWNS");
    expect(naiveFieldNameAlignment(hubspotOwner)).toBe("OWNS");
  });

  it("maps Jira assignee to a work-item role rather than generic ownership", () => {
    expect(
      createSourceSchemaTerm({
        sourceSystem: "jira",
        objectType: "issue",
        surface: "assignee",
        contextualRole: "work_item_assignment",
      }),
    ).toMatchObject({ canonicalHint: "WORK_ITEM_ASSIGNEE" });
  });

  it("maps the audited Jira assigned-to surface to the same work-item role", () => {
    const assignee = createSourceSchemaTerm({
      sourceSystem: "jira",
      objectType: "issue",
      surface: "assignee",
      contextualRole: "work_item_assignment",
    });
    const assignedTo = createSourceSchemaTerm({
      sourceSystem: "jira",
      objectType: "issue",
      surface: "assigned to",
      contextualRole: "work_item_assignment",
    });

    expect(assignedTo.id).not.toBe(assignee.id);
    expect(assignedTo.normalizedSurface).toBe("assigned_to");
    expect(assignedTo.canonicalHint).toBe("WORK_ITEM_ASSIGNEE");
  });
});
