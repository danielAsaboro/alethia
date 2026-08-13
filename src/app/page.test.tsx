import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("SourceTruce evidence court", () => {
  it("renders a real-query workspace with explicit epistemic states", () => {
    const html = renderToStaticMarkup(<Home />);

    expect(html).toContain("SourceTruce");
    expect(html).toContain("Enterprise evidence court");
    expect(html).toContain("Run evidence query");
    expect(html).toContain("SUPPORTED");
    expect(html).toContain("DISPUTED");
    expect(html).toContain("NOT_FOUND");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("HydraDB unavailable");
  });
});
