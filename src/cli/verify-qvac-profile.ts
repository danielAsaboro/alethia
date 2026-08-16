import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ErbAdapter } from "@/ingestion/erb-adapter";
import { QvacClient, QvacExtractionError } from "@/qvac/client";
import { QVAC_MODEL_ALIAS, QVAC_MODEL_SHA256, qvacRuntimeModel } from "@/qvac/model";
import { parseQvacTelemetry, recordGroundingValidation } from "@/qvac/telemetry";

interface Args { documents: string; boundarySource: string; serverLog: string; nativeLog?: string; config: string; model: string; output: string }
const usage = "Usage: npm run qvac:verify-profile -- --documents <erb.jsonl> --boundary-source <canonical.json> --server-log <log> [--native-log <log>] --config <qvac-config.json> --model <gguf> --output <artifact.json>";

export function parseVerifyQvacProfileArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = { "--documents": "documents", "--boundary-source": "boundarySource", "--server-log": "serverLog", "--native-log": "nativeLog", "--config": "config", "--model": "model", "--output": "output" };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]], value = args[index + 1];
    if (!key || !value || values[key]) throw new TypeError(usage);
    values[key] = value;
  }
  if (!values.documents || !values.boundarySource || !values.serverLog || !values.config || !values.model || !values.output) throw new TypeError(usage);
  return values as Args;
}

function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function erbDocuments(input: string) {
  const result: Array<{ id: string; sourceSystem: string; body: string }> = [];
  for await (const event of new ErbAdapter().read(input)) if (event.type === "record" && typeof event.record.fields.body === "string") result.push({ id: event.record.sourceNativeId, sourceSystem: event.record.sourceSystem, body: event.record.fields.body });
  return result.sort((left, right) => right.body.length - left.body.length || left.id.localeCompare(right.id));
}

export function canonicalBoundarySlice(
  source: string,
  maximumCharacters: number,
): { body: string; finalCompleteString: string } {
  const candidate = source.slice(0, maximumCharacters);
  let selected: { value: string; end: number } | undefined;
  let preferred: { value: string; end: number } | undefined;
  let secondary: { value: string; end: number } | undefined;
  const preferredKeys = new Set(["text", "content", "body", "subject", "title"]);
  const secondaryKeys = new Set(["name", "role"]);
  for (const lineMatch of candidate.matchAll(/([^\n]*)\n/g)) {
    const line = lineMatch[1] ?? "";
    const propertyValue = line.match(
      /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/,
    );
    const arrayValue = line.match(
      /^\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/,
    );
    if ((!propertyValue && !arrayValue) || lineMatch.index === undefined) continue;
    const rawValue = propertyValue?.[2] ?? arrayValue?.[1];
    if (rawValue === undefined) continue;
    const parsed = {
      value: JSON.parse(`"${rawValue}"`) as string,
      end: lineMatch.index + line.lastIndexOf('"') + 1,
    };
    selected = parsed;
    const rawKey = propertyValue?.[1];
    if (rawKey !== undefined) {
      const key = JSON.parse(`"${rawKey}"`) as string;
      if (preferredKeys.has(key)) preferred = parsed;
      if (secondaryKeys.has(key)) secondary = parsed;
    }
  }
  const chosen = preferred ?? secondary ?? selected;
  if (!chosen) {
    throw new TypeError("Canonical boundary slice lacks a complete JSON string");
  }
  return {
    body: candidate.slice(0, chosen.end),
    finalCompleteString: chosen.value,
  };
}

async function extraction(client: QvacClient, item: { id: string; sourceSystem: string; body: string }, description: string) {
  const started = performance.now();
  try {
    const result = await client.extractClaims({ subjectEntityId: `qvac_profile_${item.id}`, sourceObjectId: item.id, sourceSystem: item.sourceSystem, sourceText: item.body, predicates: [{ predicate: "profile_fact", description }], maxClaims: 1 });
    return { sourceNativeId: item.id, sourceCharacters: item.body.length, responseText: result.responseText, validation: recordGroundingValidation({ responseText: result.responseText, sourceText: item.body, allowedPredicates: ["profile_fact"], latencyMs: performance.now() - started }) };
  } catch (error) {
    const responseText = error instanceof QvacExtractionError ? error.responseText : "";
    return { sourceNativeId: item.id, sourceCharacters: item.body.length, responseText, validation: responseText ? recordGroundingValidation({ responseText, sourceText: item.body, allowedPredicates: ["profile_fact"], latencyMs: performance.now() - started }) : { status: "rejected" as const, reason: "runtime_error", claims: [], rawResponseSha256: sha256(responseText), latencyMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) } };
  }
}

async function main(): Promise<void> {
  const args = parseVerifyQvacProfileArgs(process.argv.slice(2));
  const [documents, boundaryBytes, configBytes, modelBytesBefore] = await Promise.all([erbDocuments(path.resolve(args.documents)), readFile(path.resolve(args.boundarySource), "utf8"), readFile(path.resolve(args.config), "utf8"), stat(path.resolve(args.model))]);
  if (documents.length < 2) throw new TypeError("QVAC profile requires at least two canonical ERB documents");
  const config = JSON.parse(configBytes) as { serve?: { models?: Record<string, { config?: { ctx_size?: number; gpu_layers?: number } }> } };
  const profile = config.serve?.models?.[QVAC_MODEL_ALIAS]?.config;
  if (!profile) throw new TypeError("QVAC config lacks the pinned model profile");
  const boundaryCharacters = Math.min(
    boundaryBytes.length,
    profile.ctx_size === 16_384 ? 38_000 : 32_000,
  );
  const boundarySlice = canonicalBoundarySlice(boundaryBytes, boundaryCharacters);
  const boundary = { id: path.basename(args.boundarySource), sourceSystem: "herb", body: boundarySlice.body };
  const client = new QvacClient();
  const extractions = [];
  for (const item of [documents[0]!, documents[1]!, boundary]) extractions.push(await extraction(client, item, item === boundary ? "Extract the explicit accessibility standard named in the closing source discussion. Use an exact contiguous closing-source quote as evidence." : "Extract exactly one explicit operational fact that answers the document title or central subject."));
  const [serverLog, nativeLog, modelSha256, modelBytesAfter] = await Promise.all([readFile(path.resolve(args.serverLog), "utf8"), args.nativeLog ? readFile(path.resolve(args.nativeLog), "utf8") : Promise.resolve(""), sha256File(path.resolve(args.model)), stat(path.resolve(args.model))]);
  const telemetry = parseQvacTelemetry({ log: `${nativeLog}\n${serverLog}`, config: profile });
  if (modelSha256 !== QVAC_MODEL_SHA256 || modelBytesBefore.size !== modelBytesAfter.size) throw new Error("Pinned QVAC model verification failed");
  const boundaryExtraction = extractions[2]!;
  const boundaryClaims = boundaryExtraction.validation.status === "accepted" ? boundaryExtraction.validation.claims : [];
  const nearBoundaryGrounded = boundaryClaims.some((claim) => boundary.body.lastIndexOf(claim.evidenceQuote) / boundary.body.length >= 0.75);
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: { ...qvacRuntimeModel(QVAC_MODEL_ALIAS), absolutePath: path.resolve(args.model), bytes: modelBytesAfter.size, verifiedSha256: modelSha256 },
    configuredProfile: { contextSize: profile.ctx_size ?? null, gpuLayersRequested: profile.gpu_layers ?? null },
    observedTelemetry: telemetry,
    serverLog: { path: path.resolve(args.serverLog), sha256: sha256(serverLog) },
    nativeLog: args.nativeLog ? { path: path.resolve(args.nativeLog), sha256: sha256(nativeLog) } : null,
    hardware: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? "unknown", logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
    workload: { canonicalErbDocuments: 2, canonicalHerbBoundarySlice: 1, multiDocument: true, maximumSourceCharacters: Math.max(...extractions.map((item) => item.sourceCharacters)), nearBoundaryGrounded },
    extractions,
    summary: { accepted: extractions.filter((item) => item.validation.status === "accepted" && item.validation.claims.length > 0).length, rejected: extractions.filter((item) => item.validation.status === "rejected" || item.validation.claims.length === 0).length, observedBackend: telemetry.backend, gpuGateProven: telemetry.backend === "gpu" && telemetry.layersOffloaded !== null && telemetry.layersOffloaded > 0, contextGateProven: profile.ctx_size === 16384, nearBoundaryGroundingProven: nearBoundaryGrounded },
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, summary: artifact.summary, requests: telemetry.requests.length, modelSha256 }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
