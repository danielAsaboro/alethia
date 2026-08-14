import path from "node:path";

import { describe, expect, it } from "vitest";

import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { mapIngestionToGraph } from "./write-bundle";

describe("mapIngestionToGraph", () => {
  it("maps the complete real HERB lane into provenance-bearing graph structure", async () => {
    const ingestion = await runIngestion(
      new HerbAdapter(),
      path.resolve(process.cwd(), "../resources/HERB"),
    );
    const graph = mapIngestionToGraph(ingestion);

    expect(graph.nodes).toHaveLength(12378);
    expect(graph.edges).toHaveLength(22906);
    expect(
      graph.nodes.filter((node) => node.label === "ResolutionDecision"),
    ).toHaveLength(1645);
    expect(
      graph.edges.filter((edge) => edge.type === "ASSERTS"),
    ).toHaveLength(5130);
    expect(
      graph.edges.filter((edge) => edge.type === "SUPPORTED_BY"),
    ).toHaveLength(6793);
    expect(
      graph.edges.filter((edge) => edge.type === "CONSIDERS"),
    ).toHaveLength(3290);
    expect(
      graph.edges.filter((edge) => edge.type === "HAS_IDENTITY"),
    ).toHaveLength(1396);
    expect(
      graph.edges.filter((edge) => edge.type === "BLOCKED_BY"),
    ).toHaveLength(1627);
    expect(
      graph.edges.filter((edge) => edge.type === "HAS_TEAM_MEMBER"),
    ).toHaveLength(1370);
    expect(
      graph.edges.filter((edge) => edge.type === "SERVES_CUSTOMER"),
    ).toHaveLength(720);
    expect(
      graph.edges.filter((edge) => edge.type === "MANAGES"),
    ).toHaveLength(512);
  });
});
