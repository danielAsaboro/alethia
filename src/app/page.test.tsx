import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("SourceTruce evidence court", () => {
  it("renders four one-click cases without ontology implementation inputs", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("SourceTruce");
    expect(html).toContain("Enterprise evidence court");
    expect(html).toContain("Resolve a conflict");
    expect(html).toContain("Leave a conflict open");
    expect(html).toContain("Disambiguate “owner”");
    expect(html).toContain("Decide who this person is");
    expect(html).toContain("Admit uncertainty");
    expect(html).toContain("what would change it");
    expect(html).toContain("Fail closed");
    expect(html).not.toContain("Canonical entity ID");
    expect(html).not.toContain("Coverage family");
    expect(html).not.toContain(">Predicate<");
  });
});
