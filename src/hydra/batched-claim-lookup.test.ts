import { afterEach, describe, expect, it, vi } from "vitest";
import { HydraRepository } from "./client";

function repository() {
  return new HydraRepository({ httpUrl: "http://hydra.test", token: "token", graphId: "default", namespace: "default", cellId: "cell-0" });
}

afterEach(() => vi.unstubAllGlobals());

describe("HydraRepository.findClaimsForSources", () => {
  it("uses one strong read for many anchored source IDs and returns a receipt", async () => {
    const claimPayload = JSON.stringify({ predicate: "has_role", objectJson: JSON.stringify({ kind: "literal", value: "Engineer" }), extractionMethod: "deterministic", extractorVersion: "v1" });
    const sourcePayload = JSON.stringify({ sourceSystem: "herb", nativeId: "e1" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query_id: "batch-query-1", columns: ["claim", "claimPayload", "source", "sourcePayload"],
      rows: [[{ type: "string", value: "claim-1" }, { type: "string", value: claimPayload }, { type: "string", value: "source-a" }, { type: "string", value: sourcePayload }]],
      read_epoch: 7, bookmark: "bookmark-7",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await repository().findClaimsForSources(["source-b", "source-a", "source-a"]);
    expect(result).toMatchObject({ operation: "batched_source_claim_lookup", consistency: "strong", queryId: "batch-query-1", queryIds: ["batch-query-1"], roundTrips: 1, requestedSources: 2 });
    expect(result.rows).toHaveLength(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.consistency).toBe("strong");
    expect(Object.keys(request.parameters)).toHaveLength(2);
    expect(request.query).toMatch(/WHERE s\.id = \$source0 OR s\.id = \$source1/);
  });

  it("rejects empty or oversized batches without a graph request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(repository().findClaimsForSources([])).rejects.toThrow(/1-100/);
    await expect(repository().findClaimsForSources(Array.from({ length: 101 }, (_, index) => `s-${index}`))).rejects.toThrow(/1-100/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
