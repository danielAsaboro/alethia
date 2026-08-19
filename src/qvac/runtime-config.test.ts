import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("QVAC runtime config rendering", () => {
  it("supports a validated context-size override without changing the model path", () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "alethia-qvac-"));
    const outputPath = path.join(temporaryDirectory, "runtime.json");
    execFileSync(process.execPath, ["scripts/render-qvac-runtime-config.mjs"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        QVAC_CTX_SIZE: "32768",
        QVAC_RUNTIME_CONFIG_OUTPUT: outputPath,
      },
    });
    const config = JSON.parse(readFileSync(outputPath, "utf8")) as {
      serve: { models: Record<string, { src: string; config: Record<string, unknown> }> };
    };

    expect(config.serve.models["alethia-extractor"].config.ctx_size).toBe(32768);
    expect(config.serve.models["alethia-extractor"].src).toBe(
      path.resolve(".local/models/Qwen3.8-27B-UD-Q4_K_XL.gguf"),
    );
  });

  it("rejects unsafe or malformed context-size overrides", () => {
    for (const value of ["nope", "511", "262145"]) {
      expect(() =>
        execFileSync(process.execPath, ["scripts/render-qvac-runtime-config.mjs"], {
          cwd: path.resolve("."),
          env: {
            ...process.env,
            QVAC_CTX_SIZE: value,
            QVAC_RUNTIME_CONFIG_OUTPUT: path.join(os.tmpdir(), `qvac-invalid-${value}.json`),
          },
          stdio: "pipe",
        }),
      ).toThrow();
    }
  });
});
