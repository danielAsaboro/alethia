import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("SourceTruce landing page", () => {
  it("introduces the evidence method and links to the real console", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("SourceTruce");
    expect(html).toContain("MAKE CONFLICT");
    expect(html).toContain("EXPLAIN ITSELF");
    expect(html).toContain('href="/workspace"');
    expect(html).toContain('aria-label="Evidence Atelier hero"');
    expect(html).toContain('aria-label="SourceTruce capabilities"');
    expect(html).toContain('aria-label="Real judge case preview"');
    expect(html).toContain('aria-label="HydraDB evidence architecture"');
    expect(html).toContain('evidence-sculpture.png');
    expect(html).toContain('evidence-ring.png');
    expect(html).toContain('source-object-cluster.png');
    expect(html).toContain("Record");
    expect(html).toContain("Claim");
    expect(html).toContain("Conflict");
    expect(html).toContain("Decision");
    expect(html).toContain("Evidence");
    expect(html).toContain("algo.SPpaths");
    expect(html).toContain("Enterprise RAG Bench");
    expect(html).toContain("Salesforce HERB");
    expect(html).not.toContain('aria-label="Judge cases"');
    expect(html.toLowerCase()).not.toContain("nocta");
    expect(html).not.toContain("Trusted Client");
  });
});
