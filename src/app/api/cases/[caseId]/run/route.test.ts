import { beforeEach, describe, expect, it, vi } from "vitest";
import { runJudgeCase } from "@/application/run-case";
import { POST } from "./route";

vi.mock("@/application/run-case", () => ({ runJudgeCase: vi.fn() }));

const mockedRunJudgeCase = vi.mocked(runJudgeCase);

const graphProof = {
  operation: "algo.SPpaths" as const,
  consistency: "strong" as const,
  queryId: "alethia-read-route-test",
  queryIds: ["alethia-read-route-test"],
  readEpoch: 1236,
  bookmark: "sgk:test:1236",
  latencyMs: 2.5,
  roundTrips: 1 as const,
  pathLength: 1,
  path: "claim → source",
  relationshipTypes: ["SUPPORTED_BY"],
  nodes: [
    { logicalId: "claim", labels: ["Claim"] },
    { logicalId: "source", labels: ["SourceObject"] },
  ],
};

describe("POST /api/cases/:caseId/run", () => {
  beforeEach(() => {
    mockedRunJudgeCase.mockReset();
  });

  it("returns 404 before touching HydraDB for an unknown case", async () => {
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ caseId: "missing" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "case_not_found" });
    expect(mockedRunJudgeCase).not.toHaveBeenCalled();
  });

  it("serializes graphProof unchanged", async () => {
    mockedRunJudgeCase.mockResolvedValue({
      case: {
        id: "streamly-credit-conflict",
        kind: "conflict",
        behavior: "resolved_conflict",
        title: "Resolve a conflict",
        question: "Which value controls?",
        summary: "Two sources disagree.",
        dataset: "ERB",
        version: "v1",
      },
      verdict: "SUPPORTED",
      answer: "30%",
      evidence: [],
      decision: { status: "resolved", reason: "policy" },
      coverage: { sufficient: true, detail: "complete" },
      counterfactual: "later policy",
      traversal: "Claim → SourceObject",
      ablation: { label: "No policy", result: "DISPUTED" },
      graphProof,
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ caseId: "streamly-credit-conflict" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.graphProof).toEqual(graphProof);
  });

  it("returns 503 without a workspace when a graph read fails", async () => {
    mockedRunJudgeCase.mockRejectedValue(new Error("HydraDB query failed (503): unavailable"));

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ caseId: "streamly-credit-conflict" }),
    });
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "case_unavailable",
      detail: "HydraDB query failed (503): unavailable",
    });
    expect(body).not.toHaveProperty("workspace");
  });
});
