import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("real-Hydra CI log capture", () => {
  it("captures logs by Compose service so application renames cannot break the job", () => {
    const workflow = readFileSync(
      path.resolve(".github/workflows/engineering.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "docker compose logs --no-color hydradb > hydradb-ci.log 2>&1",
    );
  });
});
