import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/cases", () => {
  it("returns runtime-safe cases including an unresolved conflict", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.cases).toHaveLength(5);
    expect(body.cases.map((item: { id: string }) => item.id)).toContain("handshake-ttl-conflict");
    expect(JSON.stringify(body)).not.toMatch(/gold_answer|answer_facts/);
  });
});
