import { describe, expect, test } from "vitest";

import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import { DeterministicClaimExtractor } from "./deterministic-extractor";

describe("ERB document deterministic claims", () => {
  test("turns real document provenance fields into queryable claims without inventing prose semantics", async () => {
    const source: NormalizedSourceObject = {
      id: "source_doc_1",
      sourceSystem: "github",
      sourceObjectType: "document",
      sourceNativeId: "dsid_abc123",
      sourcePath: "/canonical.jsonl#L1",
      contentScope: "body",
      payloadDigest: "payload-digest",
      fields: {
        dataset: "onyx-dot-app/EnterpriseRAG-Bench",
        docId: "dsid_abc123",
        title: "Release decision",
        body: "The release was approved after review.",
        contentDigest: "content-digest",
      },
      identities: [{
        kind: "external_id",
        value: "dsid_abc123",
        normalizedValue: "dsid_abc123",
        sourceSystem: "github",
      }],
    };

    const result = await new DeterministicClaimExtractor().extract(source, {
      entityBySourceObjectId: new Map([[source.id, "entity_doc_1"]]),
      entityByExternalId: new Map(),
    });

    expect(result.gaps).toEqual([]);
    expect(result.claims.map((claim) => [claim.predicate, claim.object])).toEqual([
      ["document_title", { kind: "literal", value: "Release decision" }],
      ["origin_system", { kind: "literal", value: "github" }],
      ["part_of_dataset", { kind: "literal", value: "onyx-dot-app/EnterpriseRAG-Bench" }],
      ["content_digest", { kind: "literal", value: "content-digest" }],
    ]);
    expect(JSON.stringify(result.claims)).not.toContain("release was approved");
  });
});
