import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("SourceTruce landing page", () => {
  it("introduces the evidence method and links to the real console", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("SourceTruce");
    expect(html).toContain('href="/workspace"');
    expect(html).toContain("Record");
    expect(html).toContain("Claim");
    expect(html).toContain("Conflict");
    expect(html).toContain("Decision");
    expect(html).toContain("Evidence");
    expect(html).toContain("algo.SPpaths");
    expect(html).toContain("Enterprise RAG Bench");
    expect(html).toContain("Salesforce HERB");
    expect(html).not.toContain('aria-label="Judge cases"');
  });
});
