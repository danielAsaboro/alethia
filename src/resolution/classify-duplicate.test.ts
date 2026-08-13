import { describe, expect, it } from "vitest";

import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import { classifyDuplicate } from "./classify-duplicate";

function sourceObject(
  overrides: Partial<NormalizedSourceObject> = {},
): NormalizedSourceObject {
  return {
    id: "source_object_a",
    sourceSystem: "herb",
    sourceObjectType: "employee",
    sourceNativeId: "eid_1",
    sourcePath: "/private/herb/employee.json",
    contentScope: "metadata",
    payloadDigest: "a".repeat(64),
    fields: { name: "Sam Rivera", role: "Engineer" },
    identities: [],
    ...overrides,
  };
}

describe("classifyDuplicate", () => {
  it("detects byte-equivalent logical payloads without discarding either source", () => {
    expect(
      classifyDuplicate(
        sourceObject(),
        sourceObject({ id: "source_object_b", sourcePath: "/private/herb/copy.json" }),
      ),
    ).toEqual({
      leftSourceObjectId: "source_object_a",
      rightSourceObjectId: "source_object_b",
      classification: "exact_duplicate",
      reasons: ["payload_digest_equal"],
    });
  });

  it("detects normalized near duplicates", () => {
    expect(
      classifyDuplicate(
        sourceObject(),
        sourceObject({
          id: "source_object_b",
          sourceNativeId: "eid_2",
          payloadDigest: "b".repeat(64),
          fields: { name: "  SAM   RIVERA ", role: "engineer" },
        }),
      ),
    ).toMatchObject({
      classification: "near_duplicate",
      reasons: ["normalized_fields_equal"],
    });
  });

  it("treats changed payloads for the same source identity as versions", () => {
    expect(
      classifyDuplicate(
        sourceObject(),
        sourceObject({
          id: "source_object_b",
          payloadDigest: "b".repeat(64),
          fields: { name: "Sam Rivera", role: "Staff Engineer" },
        }),
      ),
    ).toMatchObject({
      classification: "version_candidate",
      reasons: ["same_source_native_id", "payload_digest_changed"],
    });
  });

  it("leaves unrelated source objects unlinked", () => {
    expect(
      classifyDuplicate(
        sourceObject(),
        sourceObject({
          id: "source_object_b",
          sourceNativeId: "eid_99",
          payloadDigest: "b".repeat(64),
          fields: { name: "Alex Chen", role: "Product Manager" },
        }),
      ),
    ).toMatchObject({ classification: "distinct", reasons: [] });
  });
});
