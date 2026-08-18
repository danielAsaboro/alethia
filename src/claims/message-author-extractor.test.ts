import { describe, expect, it } from "vitest";

import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import { DeterministicClaimExtractor } from "./deterministic-extractor";

describe("DeterministicClaimExtractor message authors", () => {
  it("links an author to the real product entity and preserves its observed message count", async () => {
    const source: NormalizedSourceObject = {
      id: "source_author", sourceSystem: "herb", sourceObjectType: "message_author",
      sourceNativeId: "ActionGenie:author:eid_13fdff84", sourcePath: "/canonical/ActionGenie.json",
      contentScope: "metadata", payloadDigest: "a".repeat(64),
      fields: { name: "eid_13fdff84", productName: "ActionGenie", authorHandle: "eid_13fdff84", messageCount: 7 },
      identities: [{ kind: "handle", value: "eid_13fdff84", normalizedValue: "eid_13fdff84", sourceSystem: "herb:slack" }],
    };
    const result = await new DeterministicClaimExtractor().extract(source, {
      entityBySourceObjectId: new Map([[source.id, "entity_author"]]),
      entityByExternalId: new Map([["herb:product:actiongenie", "entity_product"]]),
    });

    expect(result.gaps).toEqual([]);
    expect(result.claims.map((claim) => [claim.predicate, claim.object])).toEqual([
      ["display_name", { kind: "literal", value: "eid_13fdff84" }],
      ["authored_messages_in_product", { kind: "entity", entityId: "entity_product" }],
      ["message_count", { kind: "literal", value: 7 }],
    ]);
  });
});
