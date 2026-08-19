import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("real-Hydra CI log capture", () => {
  it("captures logs from the renamed HydraDB container without Compose interpolation", () => {
    const workflow = readFileSync(
      path.resolve(".github/workflows/engineering.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "docker logs alethia-hydradb > hydradb-ci.log 2>&1",
    );
  });
});
