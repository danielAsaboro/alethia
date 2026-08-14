import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/cases", () => {
  it("returns four runtime-safe cases", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.cases).toHaveLength(4);
    expect(JSON.stringify(body)).not.toMatch(/gold_answer|answer_facts/);
  });
});
