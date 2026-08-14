import { describe, expect, it } from "vitest";

import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import { auditSourceVersions } from "./audit-source-versions";

function source(id: string, nativeId: string, payloadDigest: string): NormalizedSourceObject {
  return {
    id,
    sourceSystem: "jira",
    sourceObjectType: "document",
    sourceNativeId: nativeId,
    sourcePath: "records.jsonl",
    contentScope: "body",
    payloadDigest,
    fields: {},
    identities: [],
  };
}

describe("auditSourceVersions", () => {
  it("links divergent payloads sharing a source-qualified native ID", () => {
    const audit = auditSourceVersions([
      source("source_b", "dsid_shared", "digest_b"),
      source("source_a", "dsid_shared", "digest_a"),
      source("source_other", "dsid_other", "digest_c"),
    ]);

    expect(audit.groups).toEqual([
      {
        sourceSystem: "jira",
        sourceNativeId: "dsid_shared",
        sourceObjectIds: ["source_a", "source_b"],
        payloadDigests: ["digest_a", "digest_b"],
        chronologyKnown: false,
      },
    ]);
    expect(audit.relations).toEqual([
      {
        type: "VERSION_OF",
        sourceObjectId: "source_b",
        targetSourceObjectId: "source_a",
        reason: "same_native_id_divergent_digest",
        orderKnown: false,
      },
    ]);
  });

  it("does not call byte-identical repeats divergent versions", () => {
    expect(
      auditSourceVersions([
        source("source_a", "dsid_shared", "digest_a"),
        source("source_duplicate", "dsid_shared", "digest_a"),
      ]),
    ).toEqual({ groups: [], relations: [] });
  });
});
