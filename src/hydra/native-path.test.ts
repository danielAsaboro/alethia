import { afterEach, describe, expect, it, vi } from "vitest";

import { hydraIntId } from "./hydra-id";
import { HydraRepository } from "./client";

const sourceLogicalId = "entity_native_path_source";
const targetLogicalId = "source_native_path_target";
const sourceId = hydraIntId(sourceLogicalId);
const claimId = hydraIntId("claim_native_path_middle");
const targetId = hydraIntId(targetLogicalId);

function taggedString(value: string): { String: string } {
  return { String: value };
}

function validPath(): Record<string, unknown> {
  return {
    nodes: [
      {
        id: sourceId,
        labels: ["Entity"],
        properties: { logical_id: taggedString(sourceLogicalId) },
      },
      {
        id: claimId,
        labels: ["Claim"],
        properties: { logical_id: taggedString("claim_native_path_middle") },
      },
      {
        id: targetId,
        labels: ["SourceObject"],
        properties: { logical_id: taggedString(targetLogicalId) },
      },
    ],
    relationships: [
      {
        id: 101,
        edge_type: "ASSERTS",
        src: sourceId,
        dst: claimId,
        properties: { logical_id: taggedString("edge_native_asserts") },
      },
      {
        id: 102,
        edge_type: "SUPPORTED_BY",
        src: claimId,
        dst: targetId,
        properties: { logical_id: taggedString("edge_native_supported_by") },
      },
    ],
  };
}

function hydraResponse(path: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      query_id: "native-path-query-1",
      columns: ["path", "pathWeight", "pathCost"],
      rows: [
        [
          { type: "path", value: path },
          { type: "integer", value: 2 },
          { type: "integer", value: 0 },
        ],
      ],
      read_epoch: 1229,
      next_cursor: null,
      bookmark: "sgk:1:default:1229",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function repository(): HydraRepository {
  return new HydraRepository({
    httpUrl: "http://hydra.test",
    token: "test-token",
    graphId: "default",
    namespace: "default",
    cellId: "cell-0",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HydraRepository.findNativePaths", () => {
  it("preserves strong-read metadata and validates a hydrated native path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(hydraResponse(validPath()));
    vi.stubGlobal("fetch", fetchMock);

    const paths = await repository().findNativePaths({
      sourceLogicalId,
      targetLogicalId,
      relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
      maxLength: 3,
      pathCount: 1,
    });

    expect(paths).toEqual([
      {
        operation: "algo.SPpaths",
        consistency: "strong",
        queryId: "native-path-query-1",
        readEpoch: 1229,
        bookmark: "sgk:1:default:1229",
        latencyMs: expect.any(Number),
        roundTrips: 1,
        pathLength: 2,
        pathWeight: 2,
        pathCost: 0,
        nodes: [
          { id: sourceId, labels: ["Entity"], logicalId: sourceLogicalId },
          {
            id: claimId,
            labels: ["Claim"],
            logicalId: "claim_native_path_middle",
          },
          {
            id: targetId,
            labels: ["SourceObject"],
            logicalId: targetLogicalId,
          },
        ],
        relationships: [
          {
            id: 101,
            type: "ASSERTS",
            sourceId,
            targetId: claimId,
            logicalId: "edge_native_asserts",
          },
          {
            id: 102,
            type: "SUPPORTED_BY",
            sourceId: claimId,
            targetId,
            logicalId: "edge_native_supported_by",
          },
        ],
      },
    ]);

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(request.consistency).toBe("strong");
    expect(request.query).toContain("CALL algo.SPpaths");
    expect(request.query).toContain("relDirection: 'outgoing'");
  });

  it("fails closed when the returned path has the wrong endpoint", async () => {
    const path = validPath();
    const nodes = path.nodes as Array<Record<string, unknown>>;
    nodes[nodes.length - 1] = {
      ...nodes[nodes.length - 1],
      id: hydraIntId("source_wrong_target"),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(hydraResponse(path)));

    await expect(
      repository().findNativePaths({
        sourceLogicalId,
        targetLogicalId,
        relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
        maxLength: 3,
        pathCount: 1,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("fails closed on malformed topology", async () => {
    const path = validPath();
    (path.relationships as unknown[]).pop();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(hydraResponse(path)));

    await expect(
      repository().findNativePaths({
        sourceLogicalId,
        targetLogicalId,
        relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
        maxLength: 3,
        pathCount: 1,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("fails closed when Hydra returns a disallowed relationship type", async () => {
    const path = validPath();
    const relationships = path.relationships as Array<Record<string, unknown>>;
    relationships[1] = { ...relationships[1], edge_type: "CONTRADICTS" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(hydraResponse(path)));

    await expect(
      repository().findNativePaths({
        sourceLogicalId,
        targetLogicalId,
        relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
        maxLength: 3,
        pathCount: 1,
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe("HydraRepository.findNativeMultiPaths", () => {
  it("runs directed label-distinct indexed pairs in one strong MSpaths request", async () => {
    const pairs = [
      ["source_term_file", "ontology_file_owner"],
      ["source_term_opportunity", "ontology_opportunity_owner"],
    ] as const;
    const rows = pairs.map(([source, target], index) => [
      {
        type: "path",
        value: {
          nodes: [
            { id: hydraIntId(source), labels: ["SourceSchemaTerm"], properties: { logical_id: taggedString(source) } },
            { id: hydraIntId(target), labels: ["OntologyTerm"], properties: { logical_id: taggedString(target) } },
          ],
          relationships: [{
            id: 200 + index,
            edge_type: "MAPS_TO",
            src: hydraIntId(source),
            dst: hydraIntId(target),
            properties: { logical_id: taggedString(`maps-${index}`) },
          }],
        },
      },
      { type: "integer", value: 1 },
      { type: "integer", value: 0 },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      query_id: "native-multi-query-1",
      columns: ["path", "pathWeight", "pathCost"],
      rows,
      read_epoch: 1230,
      bookmark: "sgk:1:default:1230",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await repository().findNativeMultiPaths({
      sourceLabel: "SourceSchemaTerm",
      sourceLogicalIds: pairs.map(([source]) => source),
      targetLabel: "OntologyTerm",
      targetLogicalIds: pairs.map(([, target]) => target),
      relationshipTypes: ["MAPS_TO"],
      maxLength: 1,
      pathCount: 1,
    });

    expect(result).toMatchObject({
      operation: "algo.MSpaths",
      consistency: "strong",
      queryId: "native-multi-query-1",
      pairCount: 2,
      pathCount: 2,
      roundTrips: 1,
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      query: string;
      parameters: Record<string, unknown>;
      consistency: string;
    };
    expect(request.query).toContain("CALL algo.MSpaths");
    expect(request.query).toContain("pairwise: false");
    expect(request.query).toContain("sourceValues: ['source_term_file', 'source_term_opportunity']");
    expect(request.parameters).not.toHaveProperty("sources");
    expect(request.consistency).toBe("strong");
  });

  it("rejects selector injection before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(repository().findNativeMultiPaths({
      sourceLabel: "SourceSchemaTerm",
      sourceLogicalIds: ["safe", "bad' selector"],
      targetLabel: "OntologyTerm",
      targetLogicalIds: ["target-a", "target-b"],
      relationshipTypes: ["MAPS_TO"],
      maxLength: 1,
      pathCount: 1,
    })).rejects.toThrow(/unsafe selector/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
