import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/cases/:caseId/run", () => {
  it("returns 404 before touching HydraDB for an unknown case", async () => {
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ caseId: "missing" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "case_not_found" });
  });
});
