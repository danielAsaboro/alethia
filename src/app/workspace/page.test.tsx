import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { listJudgeCases } from "@/cases/case-registry";
import { EvidenceWorkspace } from "../components/evidence-workspace";
import Workspace, { AlethiaApp } from "./page";

describe("Alethia evidence court", () => {
  it("renders an evidence console with all eleven real cases and no ontology implementation inputs", () => {
    const html = renderToStaticMarkup(<Workspace />);

    expect(html).toContain("Alethia");
    expect(html).not.toContain("SourceTruce");
    expect(html).toContain('aria-label="Alethia application header"');
    expect(html).toContain('aria-label="Judge cases"');
    expect(html).toContain('aria-label="Evidence workspace"');
    expect(html).toContain('class="case-panel case-strip"');
    expect(html).toContain('class="question-stage"');
    expect(html).toContain("Run live case");
    expect(html).toContain("Evidence console");
    expect(html).toContain("Selected question");
    expect(html).toContain("Resolve a conflict");
    expect(html).toContain("Prove a supersession");
    expect(html).toContain("Disambiguate owner semantics");
    expect(html).toContain("Reject an incompatible alignment");
    expect(html).toContain("Resolve an identity collision");
    expect(html).toContain("Accept a verified identity link");
    expect(html).toContain("Admit incomplete coverage");
    expect(html).toContain("Retrieve a canonical fact");
    expect(html).toContain("Traverse a product team");
    expect(html).toContain("Prove a fact is not found");
    expect(html).toContain('class="case-index">10</span>');
    expect(html).toContain('class="case-index">11</span>');
    expect(html).not.toContain('class="case-index">010</span>');
    expect(html).toContain("what would change it");
    expect(html).toContain("Fail closed");
    expect(html).toContain("System unverified");
    expect(html).toContain("Ready for live query");
    expect(html).not.toContain("Canonical entity ID");
    expect(html).not.toContain("Coverage family");
    expect(html).not.toContain(">Predicate<");
  });

  it("renders an honest empty manifest state without dereferencing a selected case", () => {
    const html = renderToStaticMarkup(<AlethiaApp cases={[]} />);

    expect(html).toContain("No judge cases are configured");
    expect(html).toContain("No question selected");
    expect(html).not.toContain('aria-label="Evidence workspace"');
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
    expect(html).toContain('aria-label="Verdict chapter"');
    expect(html).toContain('aria-label="Evidence provenance chapter"');
    expect(html).toContain('aria-label="Decision and coverage chapter"');
    expect(html).toContain('class="lineage-card lineage-canvas"');
    expect(html).toContain("algo.SPpaths");
    expect(html).toContain("strong consistency");
    expect(visibleText).toContain("1 round trip");
    expect(html).toContain("sourcetruce-read-test");
    expect(html).toContain("claim_30 → source_policy");
    expect(html).toContain("sgk:test:1236");
    expect(html).toContain('aria-label="HydraDB lineage path"');
    expect(html).toContain("SUPPORTED_BY");
    expect(html).not.toContain("Node 1");
    expect(html).not.toContain('class="lineage-node source-node">Query');
  });

  it("renders disputed evidence, resolution requirements, abstention, loading, and actionable errors", () => {
    const selected = listJudgeCases()[0]!;
    const proof = {
      operation: "algo.SPpaths" as const,
      consistency: "strong" as const,
      queryId: "sourcetruce-read-state-test",
      readEpoch: 42,
      bookmark: "sgk:state:42",
      latencyMs: 2,
      roundTrips: 1 as const,
      pathLength: 2,
      path: "entity → claim → source",
      relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
    };
    const disputed = renderToStaticMarkup(<EvidenceWorkspace selected={selected} status="idle" error="" workspace={{ verdict: "DISPUTED", answer: "Two controlling records disagree.", evidence: [{ source: "jira · native-1", quote: "30%", value: "30%" }, { source: "drive · native-2", quote: "45%", value: "45%" }], decision: { status: "unresolved", reason: "No controlling policy exists." }, coverage: { sufficient: true, detail: "Both records are present." }, counterfactual: "A signed authority policy would resolve this.", traversal: "Entity → Claim → SourceObject", ablation: { label: "No conflict policy", result: "Remains DISPUTED" }, graphProof: proof }} />);
    const unknown = renderToStaticMarkup(<EvidenceWorkspace selected={selected} status="idle" error="" workspace={{ verdict: "UNKNOWN", answer: "Available evidence is insufficient.", evidence: [], decision: { status: "abstained", reason: "Coverage is incomplete." }, coverage: { sufficient: false, detail: "One source family is missing." }, counterfactual: "Ingest the missing source family.", traversal: "CoverageSlice", ablation: { label: "No coverage gate", result: "Would incorrectly return NOT_FOUND" }, graphProof: { ...proof, pathLength: 1, path: "entity → coverage", relationshipTypes: ["COVERS"] } }} />);
    const loading = renderToStaticMarkup(<EvidenceWorkspace selected={selected} status="loading" error="" workspace={null} />);
    const error = renderToStaticMarkup(<EvidenceWorkspace selected={selected} status="error" error="HydraDB query failed" workspace={null} />);

    expect(disputed).toContain("DISPUTED");
    expect(disputed).toContain("jira · native-1");
    expect(disputed).toContain("Conflict visibility");
    expect(disputed).toContain("What would change this?");
    expect(unknown).toContain("UNKNOWN");
    expect(unknown).toContain("Coverage incomplete");
    expect(unknown).toContain("No claim evidence exists");
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Evidence path in motion");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Check HydraDB availability and retry the case");
  });
});
