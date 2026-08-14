import { describe, expect, it } from "vitest";

import { decideAlignment, type AlignmentRule } from "./alignment-policy";
import { createSourceSchemaTerm } from "./source-terms";

const driveRule: AlignmentRule = {
  id: "rule_drive_file_owner_v1",
  version: "alignment-registry-v1",
  sourceSystem: "google_drive",
  objectType: "document",
  surface: "owner",
  contextualRole: "file_metadata",
  targetOntologyTermId: "ontology_file_owner",
  domain: "Document",
  range: "Person",
};

const driveOwner = createSourceSchemaTerm({
  sourceSystem: "google_drive",
  objectType: "document",
  surface: "owner",
  contextualRole: "file_metadata",
});

describe("decideAlignment", () => {
  it("accepts an exact versioned registry rule", () => {
    expect(
      decideAlignment(
        {
          term: driveOwner,
          candidate: {
            id: "ontology_file_owner",
            name: "FILE_OWNER",
            domain: "Document",
            range: "Person",
          },
          evidenceObservationIds: ["observation_drive_owner"],
        },
        [driveRule],
      ),
    ).toMatchObject({
      status: "accepted",
      policyVersion: "alignment-registry-v1",
      evidenceObservationIds: ["observation_drive_owner"],
    });
  });

  it("rejects a candidate with an incompatible domain and range", () => {
    expect(
      decideAlignment(
        {
          term: driveOwner,
          candidate: {
            id: "ontology_repository_owner",
            name: "REPOSITORY_OWNER",
            domain: "Repository",
            range: "Team",
          },
          evidenceObservationIds: ["observation_drive_owner"],
        },
        [driveRule],
      ),
    ).toMatchObject({ status: "rejected", reason: "domain_range_mismatch" });
  });

  it("leaves an unseen ambiguous phrase pending", () => {
    const informal = createSourceSchemaTerm({
      sourceSystem: "slack",
      objectType: "message",
      surface: "point person",
      contextualRole: "informal_coordination",
    });
    expect(
      decideAlignment(
        {
          term: informal,
          candidate: {
            id: "ontology_responsible_person",
            name: "RESPONSIBLE_PERSON",
            domain: "WorkItem",
            range: "Person",
          },
          evidenceObservationIds: ["observation_slack_point_person"],
        },
        [driveRule],
      ),
    ).toMatchObject({ status: "pending", reason: "no_exact_registry_rule" });
  });
});
