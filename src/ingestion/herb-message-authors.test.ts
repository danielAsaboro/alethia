import { describe, expect, it } from "vitest";

import { extractProductMessageAuthors } from "./herb-adapter";

describe("extractProductMessageAuthors", () => {
  it("normalizes unique employee and identifier-free bot authors from real HERB message shapes", () => {
    const product = {
      slack: [{
        Channel: { name: "planning", channelID: "ch-1" },
        Message: { User: { userId: "eid_13fdff84", timestamp: "2026-06-11T20:31:00", text: "Hello", utterranceID: "u-1" }, Reactions: [] },
        ThreadReplies: [], id: "u-1",
      }, {
        Channel: { name: "planning", channelID: "ch-1" },
        Message: { User: { userId: "slack_admin_bot", timestamp: "2026-06-09T00:11:00", text: "created channel", utterranceID: "u-2" }, Reactions: [] },
        ThreadReplies: [], id: "u-2",
      }, {
        Channel: { name: "planning", channelID: "ch-1" },
        Message: { User: { userId: "eid_13fdff84", timestamp: "2026-06-11T20:43:00", text: "Follow-up", utterranceID: "u-3" }, Reactions: [] },
        ThreadReplies: [], id: "u-3",
      }],
    };

    const authors = extractProductMessageAuthors({ productName: "ActionGenie", sourcePath: "/canonical/ActionGenie.json", product });

    expect(authors).toHaveLength(2);
    expect(authors.map((author) => author.sourceNativeId)).toEqual([
      "ActionGenie:author:eid_13fdff84",
      "ActionGenie:author:slack_admin_bot",
    ]);
    expect(authors[0]).toMatchObject({
      sourceSystem: "herb",
      sourceObjectType: "message_author",
      fields: { name: "eid_13fdff84", productName: "ActionGenie", authorHandle: "eid_13fdff84", messageCount: 2 },
      identities: [
        { kind: "external_id", normalizedValue: "eid_13fdff84", sourceSystem: "herb:person" },
        { kind: "handle", normalizedValue: "eid_13fdff84", sourceSystem: "herb:slack" },
      ],
    });
    expect(authors[1]).toMatchObject({
      fields: { name: "slack_admin_bot", productName: "ActionGenie", authorHandle: "slack_admin_bot", messageCount: 1 },
      identities: [{ kind: "handle", normalizedValue: "slack_admin_bot", sourceSystem: "herb:slack" }],
    });
  });
});
