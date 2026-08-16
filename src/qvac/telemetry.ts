import { createHash } from "node:crypto";

import { validateQvacExtraction, type GroundedExtraction } from "./extraction";

export interface QvacRequestTelemetry {
  generatedTokens: number;
  promptTokens: number;
  cachedTokens: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
  backend: "gpu" | "cpu" | "unknown";
}

export function parseQvacTelemetry(input: {
  log: string;
  config: { ctx_size?: unknown; gpu_layers?: unknown };
}) {
  const requests: QvacRequestTelemetry[] = [];
  const pattern = /completion done tokens=(\d+)[^\n]*?ttft=([\d.]+)(?:ms)?\b[^\n]*?tps=([\d.]+)\b[^\n]*?prompt=(\d+)[^\n]*?cache=(\d+)[^\n]*?gen=(\d+)[^\n]*?backend=(gpu|cpu)/g;
  for (const match of input.log.matchAll(pattern)) {
    requests.push({
      generatedTokens: Number(match[6] ?? match[1]),
      promptTokens: Number(match[4]),
      cachedTokens: Number(match[5]),
      timeToFirstTokenMs: Number(match[2]),
      tokensPerSecond: Number(match[3]),
      backend: match[7] === "gpu" ? "gpu" : "cpu",
    });
  }
  const offloaded = [
    ...input.log.matchAll(
      /(?:offloaded[_ -]?layers|layers[_ -]?offloaded)=(\d+)|offloaded\s+(\d+)\/\d+\s+layers\s+to\s+GPU/gi,
    ),
  ].at(-1);
  const peakMemory = [...input.log.matchAll(/peak[_ -]?memory(?:_mb)?=([\d.]+)/gi)].at(-1)?.[1];
  const observedBackend = requests.at(-1)?.backend ?? (/backend=gpu/.test(input.log) ? "gpu" : /backend=cpu/.test(input.log) ? "cpu" : "unknown");
  return {
    backend: observedBackend,
    observedBackends: [...new Set(requests.map((item) => item.backend))],
    contextSize: Number.isSafeInteger(input.config.ctx_size) ? Number(input.config.ctx_size) : null,
    layersRequested: Number.isSafeInteger(input.config.gpu_layers) ? Number(input.config.gpu_layers) : null,
    layersOffloaded: offloaded === undefined
      ? null
      : Number(offloaded[1] ?? offloaded[2]),
    peakMemoryMb: peakMemory === undefined ? null : Number(peakMemory),
    requests,
  };
}

type GroundingRecord =
  | { status: "accepted"; reason: null; claims: GroundedExtraction[]; rawResponseSha256: string; latencyMs: number }
  | { status: "rejected"; reason: "malformed_output" | "invalid_schema" | "ungrounded_output" | "validation_error"; claims: []; rawResponseSha256: string; latencyMs: number; error: string };

export function recordGroundingValidation(input: {
  responseText: string;
  sourceText: string;
  allowedPredicates: string[];
  latencyMs: number;
}): GroundingRecord {
  const rawResponseSha256 = createHash("sha256").update(input.responseText).digest("hex");
  try {
    const claims = validateQvacExtraction(input);
    return { status: "accepted", reason: null, claims, rawResponseSha256, latencyMs: input.latencyMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = /invalid JSON/i.test(message)
      ? "malformed_output"
      : /invalid schema/i.test(message)
        ? "invalid_schema"
        : /grounding validation/i.test(message)
          ? "ungrounded_output"
          : "validation_error";
    return { status: "rejected", reason, claims: [], rawResponseSha256, latencyMs: input.latencyMs, error: message };
  }
}
