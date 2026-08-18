import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { reverseResolution } from "@/resolution/resolve-entities";
import { mapIngestionToGraph } from "./write-bundle";

const herbRoot = path.resolve(process.cwd(), "../resources/HERB");

describe.runIf(existsSync(herbRoot))("mapIngestionToGraph against the canonical HERB corpus", () => {
  it("maps the complete real HERB lane into provenance-bearing graph structure", async () => {
    const ingestion = await runIngestion(
      new HerbAdapter(),
      herbRoot,
    );
    const graph = mapIngestionToGraph(ingestion);

    expect(graph.nodes).toHaveLength(29526);
    expect(graph.edges).toHaveLength(55719);
    expect(
      graph.nodes.filter((node) => node.label === "ResolutionDecision"),
    ).toHaveLength(5684);
    expect(
      graph.nodes
        .filter((node) => node.label === "ResolutionDecision")
        .every((node) => typeof node.properties.inputDigest === "string" && /^[a-f0-9]{64}$/.test(node.properties.inputDigest)),
    ).toBe(true);
    expect(
      graph.edges.filter((edge) => edge.type === "ASSERTS"),
    ).toHaveLength(10023);
    expect(
      graph.edges.filter((edge) => edge.type === "SUPPORTED_BY"),
    ).toHaveLength(17737);
    expect(
      graph.edges.filter((edge) => edge.type === "CONSIDERS"),
    ).toHaveLength(11368);
    expect(
      graph.edges.filter((edge) => edge.type === "HAS_IDENTITY"),
    ).toHaveLength(4624);
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

    const accepted = ingestion.resolution.decisions.find((decision) => decision.status === "accepted");
    if (!accepted) throw new Error("Expected an accepted HERB identity decision");
    const reversed = reverseResolution(ingestion.records, ingestion.resolution, accepted.id);
    const reversalGraph = mapIngestionToGraph({ ...ingestion, resolution: reversed });
    expect(reversalGraph.edges).toContainEqual(expect.objectContaining({
      type: "SUPERSEDES",
      sourceLogicalId: reversed.decisions.at(-1)?.id,
      targetLogicalId: accepted.id,
    }));
  });
});
