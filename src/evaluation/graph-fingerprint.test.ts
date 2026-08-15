import { describe, expect, it } from "vitest";

import { fingerprintGraph } from "./graph-fingerprint";

describe("fingerprintGraph", () => {
  const graph = {
    nodes: [
      { logicalId: "b", label: "Claim", properties: { z: 2, a: { y: 1, x: true } } },
      { logicalId: "a", label: "Entity", properties: { name: "Alpha" } },
    ],
    edges: [
      { logicalId: "e2", type: "SUPPORTED_BY", sourceLogicalId: "b", targetLogicalId: "s", properties: { rank: 1 } },
      { logicalId: "e1", type: "ASSERTS", sourceLogicalId: "a", targetLogicalId: "b", properties: {} },
    ],
  };

  it("is invariant to node, edge, and nested property key order", () => {
    const reordered = {
      nodes: [
        { logicalId: "a", label: "Entity", properties: { name: "Alpha" } },
        { logicalId: "b", label: "Claim", properties: { a: { x: true, y: 1 }, z: 2 } },
      ],
      edges: [...graph.edges].reverse(),
    };
    expect(fingerprintGraph(graph)).toEqual(fingerprintGraph(reordered));
    expect(fingerprintGraph(graph).sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes on any semantic mutation and rejects duplicate IDs", () => {
    expect(fingerprintGraph(graph).sha256).not.toBe(
      fingerprintGraph({ ...graph, nodes: [{ ...graph.nodes[0]!, properties: { z: 3 } }, graph.nodes[1]!] }).sha256,
    );
    expect(() => fingerprintGraph({ ...graph, nodes: [graph.nodes[0]!, graph.nodes[0]!] })).toThrow(/duplicate node/i);
  });
});
