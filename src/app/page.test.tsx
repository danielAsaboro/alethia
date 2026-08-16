import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { listJudgeCases } from "@/cases/case-registry";
import { EvidenceWorkspace } from "./components/evidence-workspace";
import Home from "./page";

describe("SourceTruce evidence court", () => {
  it("renders all eight one-click cases without ontology implementation inputs", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("SourceTruce");
    expect(html).toContain("Enterprise evidence court");
    expect(html).toContain("Resolve a conflict");
    expect(html).toContain("Adjudicate incomplete lifecycle evidence");
    expect(html).toContain("Disambiguate owner semantics");
    expect(html).toContain("Resolve an identity collision");
    expect(html).toContain("Admit incomplete coverage");
    expect(html).toContain("Retrieve a canonical fact");
    expect(html).toContain("Traverse a product team");
    expect(html).toContain("Prove a fact is not found");
    expect(html).toContain("what would change it");
    expect(html).toContain("Fail closed");
    expect(html).not.toContain("Canonical entity ID");
    expect(html).not.toContain("Coverage family");
    expect(html).not.toContain(">Predicate<");
  });

  it("renders the live HydraDB native path proof returned by the API", () => {
    const selected = listJudgeCases()[0]!;
    const html = renderToStaticMarkup(
      <EvidenceWorkspace
        selected={selected}
        status="idle"
        error=""
        workspace={{
          verdict: "SUPPORTED",
          answer: "30%",
          evidence: [{ source: "Drive · policy", quote: "30%", value: "30%" }],
          decision: { status: "resolved", reason: "Applied policy wins." },
          coverage: { sufficient: true, detail: "Both sources examined." },
          counterfactual: "A later applied policy would change the answer.",
          traversal: "Claim → SUPPORTED_BY → SourceObject",
          ablation: { label: "No policy", result: "DISPUTED" },
          graphProof: {
            operation: "algo.SPpaths",
            consistency: "strong",
            queryId: "sourcetruce-read-test",
            readEpoch: 1236,
            bookmark: "sgk:test:1236",
            latencyMs: 3.25,
            roundTrips: 1,
            pathLength: 1,
            path: "claim_30 → source_policy",
            relationshipTypes: ["SUPPORTED_BY"],
          },
        }}
      />,
    );
    const visibleText = html.replace(/<[^>]+>/g, "");

    expect(html).toContain("HydraDB native path");
    expect(html).toContain("algo.SPpaths");
    expect(html).toContain("strong consistency");
    expect(visibleText).toContain("1 round trip");
    expect(html).toContain("sourcetruce-read-test");
    expect(html).toContain("claim_30 → source_policy");
  });
});
