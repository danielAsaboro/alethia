import { describe, expect, it } from "vitest";

import { chunkRows } from "./client";

describe("chunkRows", () => {
  it("keeps HydraDB batches below the verified admission limit", () => {
    const rows = Array.from({ length: 1001 }, (_, index) => index);
    expect(chunkRows(rows)).toEqual([
      rows.slice(0, 500),
      rows.slice(500, 1000),
      rows.slice(1000),
    ]);
  });
});
