import { describe, expect, it } from "vitest";

import { hydraQueryId, hydraRequestQueryId } from "./client";

describe("hydraQueryId", () => {
  it("is stable for an exact retry and changes with the mutation payload", () => {
    const query = "UNWIND $rows AS row MERGE (n {id: row.id})";
    const first = hydraQueryId(query, { rows: [{ id: 1, value: "first" }] });
    const retry = hydraQueryId(query, { rows: [{ id: 1, value: "first" }] });
    const different = hydraQueryId(query, {
      rows: [{ id: 1, value: "second" }],
    });

    expect(first).toBe(retry);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^sourcetruce-[a-f0-9]{32}$/);
  });

  it("uses unique execution ids for reads but stable payload ids for mutations", () => {
    const read = "MATCH (n) RETURN n";
    expect(hydraRequestQueryId(read, {})).not.toBe(
      hydraRequestQueryId(read, {}),
    );

    const mutation = "UNWIND $rows AS row MERGE (n {id: row.id})";
    expect(hydraRequestQueryId(mutation, { rows: [{ id: 1 }] })).toBe(
      hydraRequestQueryId(mutation, { rows: [{ id: 1 }] }),
    );
  });
});
