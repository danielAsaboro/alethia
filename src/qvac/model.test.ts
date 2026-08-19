import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  QVAC_MODEL_ALIAS,
  QVAC_MODEL_SOURCE,
  qvacRuntimeModel,
} from "./model";

describe("qvacRuntimeModel", () => {
  it("identifies the pinned QVAC Qwen3.8 27B GGUF runtime behind the default alias", () => {
    expect(qvacRuntimeModel("alethia-extractor")).toEqual({
      alias: "alethia-extractor",
      modelSource: ".local/models/Qwen3.8-27B-UD-Q4_K_XL.gguf",
      downloadUrl: "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/27af057ecb382ddfea5d12837360a8980560e3ed/Qwen3.8-27B-UD-Q4_K_XL.gguf",
      modelSha256: "3f227079003add2511437e5b1e94812e363385225bf6a9b47b0054a72bc8b01e",
      expectedBytes: 17559178144,
      displayName: "Qwen3.8 27B UD-Q4_K_XL",
      parameters: "27B",
      quantization: "UD-Q4_K_XL",
    });
  });

  it("does not mislabel an explicit custom GGUF alias as the pinned model", () => {
    expect(qvacRuntimeModel("custom-qwen-gguf")).toEqual({
      alias: "custom-qwen-gguf",
      modelSource: null,
      downloadUrl: null,
      modelSha256: null,
      expectedBytes: null,
      displayName: "Custom QVAC model (custom-qwen-gguf)",
      parameters: null,
      quantization: null,
    });
  });

  it("wires the pinned local path to the explicit GPU-backed QVAC model", () => {
    const config = JSON.parse(
      readFileSync(path.resolve("qvac.config.json"), "utf8"),
    ) as {
      serve: {
        models: Record<
          string,
          {
            src: string;
            type: string;
            default: boolean;
            preload: boolean;
            config: Record<string, unknown>;
          }
        >;
      };
    };

    expect(config.serve.models[QVAC_MODEL_ALIAS]).toEqual({
      src: QVAC_MODEL_SOURCE,
      type: "llamacpp-completion",
      default: true,
      preload: true,
      config: {
        device: "gpu",
        gpu_layers: 99,
        ctx_size: 16384,
        reasoning_budget: 0,
        tools: false,
        verbosity: 2,
      },
    });

    expect(config.serve.models[QVAC_MODEL_ALIAS]?.config).not.toHaveProperty(
      "main-gpu",
    );
    expect(readFileSync(path.resolve("scripts/qvac-serve.sh"), "utf8")).toContain(
      "--verbose",
    );
  });
});
