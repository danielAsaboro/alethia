import { describe, expect, it } from "vitest";

import { parseQvacTelemetry, recordGroundingValidation } from "./telemetry";

describe("QVAC telemetry", () => {
  it("distinguishes configured profile from observed GPU/offload telemetry", () => {
    expect(parseQvacTelemetry({
      log: 'Model "sourcetruce-extractor" loaded\ncompletion done tokens=35 ttft=891 tps=4.3 prompt=1352 cache=1447 gen=35 backend=gpu offloaded_layers=99',
      config: { ctx_size: 16384, gpu_layers: 99 },
    })).toMatchObject({ backend: "gpu", contextSize: 16384, layersRequested: 99, layersOffloaded: 99, requests: [{ timeToFirstTokenMs: 891, tokensPerSecond: 4.3 }] });
  });

  it("marks absent server offload data unavailable rather than copying the requested value", () => {
    expect(parseQvacTelemetry({ log: "completion done tokens=4 ttft=100 tps=3 prompt=10 cache=12 gen=4 backend=cpu", config: { ctx_size: 16384, gpu_layers: 99 } })).toMatchObject({ backend: "cpu", layersRequested: 99, layersOffloaded: null });
  });

  it("parses native llama.cpp layer offload telemetry", () => {
    expect(parseQvacTelemetry({
      log: "print_backend_buffers_info: offloaded 66/66 layers to GPU\ncompletion done tokens=1 ttft=440 tps=6.8 prompt=16 cache=28 gen=1 backend=gpu",
      config: { ctx_size: 16384, gpu_layers: 99 },
    })).toMatchObject({ backend: "gpu", layersRequested: 99, layersOffloaded: 66 });
  });

  it("rejects truncated JSON and accepts an exact quote near the source boundary", () => {
    expect(recordGroundingValidation({ responseText: '{"claims":[', sourceText: "source", allowedPredicates: ["fact"], latencyMs: 1 })).toMatchObject({ status: "rejected", reason: "malformed_output" });
    const quote = "BOUNDARY EXACT QUOTE";
    const sourceText = `${"x".repeat(12000)}${quote}`;
    expect(recordGroundingValidation({ responseText: JSON.stringify({ claims: [{ predicate: "fact", value: quote, evidenceQuote: quote }] }), sourceText, allowedPredicates: ["fact"], latencyMs: 2 })).toMatchObject({ status: "accepted", claims: [{ evidenceQuote: quote }] });
  });
});
