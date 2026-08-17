import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createQvac } from "@qvac/ai-sdk-provider";
import { generateText } from "ai";

import { buildCausalArms, type CausalCaseInput } from "@/evaluation/causal-arms";
import { buildCausalGenerationRequest, validateCausalGenerationResponse } from "@/evaluation/causal-generation";
import { qvacRequestTimeoutMs } from "@/qvac/client";

interface Args { runtime: string; output: string; parityFrom?: string }
const usage = "Usage: npm run causal:run -- --runtime <label-free-runtime.json> [--parity-from <prior-results.json>] --output <result.json>";
const forbidden = new Set(["expected_doc_ids", "gold_answer", "answer_facts", "question_type", "expectedVerdict", "selectedAnswer", "evaluation_labels"]);

export function parseRunCausalArgs(args: string[]): Args {
  if (args.length !== 4 && args.length !== 6) throw new TypeError(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!flag || !value || !["--runtime", "--output", "--parity-from"].includes(flag) || values.has(flag)) throw new TypeError(usage);
    values.set(flag, value);
  }
  const runtime = values.get("--runtime"), output = values.get("--output");
  if (!runtime || !output) throw new TypeError(usage);
  const parityFrom = values.get("--parity-from");
  return { runtime, output, ...(parityFrom ? { parityFrom } : {}) };
}

export function assertLabelFreeCausalRuntime(value: unknown, pathSegments: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLabelFreeCausalRuntime(item, [...pathSegments, String(index)]));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new TypeError(`Causal runtime contains forbidden evaluation field at ${[...pathSegments, key].join(".")}`);
    assertLabelFreeCausalRuntime(child, [...pathSegments, key]);
  }
}

async function main() {
  const args = parseRunCausalArgs(process.argv.slice(2));
  const runtimePath = path.resolve(args.runtime);
  const runtimeBytes = await readFile(runtimePath);
  const runtime = JSON.parse(runtimeBytes.toString("utf8")) as { schemaVersion?: unknown; labelFree?: unknown; seed?: unknown; cases?: CausalCaseInput[] };
  assertLabelFreeCausalRuntime(runtime);
  if (runtime.schemaVersion !== 1 || runtime.labelFree !== true || typeof runtime.seed !== "string" || !Array.isArray(runtime.cases) || runtime.cases.length !== 19) {
    throw new TypeError("Causal runner requires the complete 19-case label-free runtime");
  }
  const paddingByAttempt = new Map<string, number>();
  let parityCalibrationSha256: string | null = null;
  if (args.parityFrom) {
    const calibrationBytes = await readFile(path.resolve(args.parityFrom));
    const calibration = JSON.parse(calibrationBytes.toString("utf8")) as { runtimeSha256?: unknown; labelsOpened?: unknown; results?: Array<Record<string, unknown>> };
    if (calibration.runtimeSha256 !== createHash("sha256").update(runtimeBytes).digest("hex") || calibration.labelsOpened !== false || !Array.isArray(calibration.results) || calibration.results.length !== 190) {
      throw new TypeError("Token-parity calibration does not match the sealed runtime");
    }
    const targets = new Map<string, number>();
    for (const row of calibration.results) {
      const inputTokens = Number((row.modelUsage as Record<string, unknown> | null)?.inputTokens);
      if (!Number.isSafeInteger(inputTokens) || inputTokens < 1) throw new TypeError("Token-parity calibration lacks model input-token usage");
      targets.set(String(row.caseId), Math.max(targets.get(String(row.caseId)) ?? 0, inputTokens));
    }
    for (const row of calibration.results) {
      const inputTokens = Number((row.modelUsage as Record<string, unknown>).inputTokens);
      paddingByAttempt.set(`${String(row.caseId)}\0${String(row.armId)}`, targets.get(String(row.caseId))! - inputTokens);
    }
    parityCalibrationSha256 = createHash("sha256").update(calibrationBytes).digest("hex");
  }
  const baseUrl = process.env.QVAC_BASE_URL ?? "http://127.0.0.1:11436/v1";
  const modelName = process.env.QVAC_MODEL ?? "sourcetruce-extractor";
  const qvac = createQvac({ baseURL: baseUrl.replace(/\/$/, ""), apiKey: process.env.QVAC_API_KEY ?? "local-loopback-only" });
  const model = qvac(modelName);
  const results = [];
  for (const causalCase of runtime.cases) {
    const arms = buildCausalArms(causalCase, runtime.seed);
    for (const arm of arms) {
      const budgetPaddingTokens = paddingByAttempt.get(`${causalCase.caseId}\0${arm.id}`) ?? 0;
      const request = buildCausalGenerationRequest(arm, budgetPaddingTokens);
      const started = performance.now();
      let responseText = "", status: "completed" | "rejected" | "failed" = "failed", response = null, rawError: string | null = null, modelUsage: unknown = null;
      try {
        const generated = await generateText({
          model,
          system: request.system,
          prompt: request.prompt,
          temperature: request.settings.temperature,
          maxOutputTokens: request.settings.maxOutputTokens,
          abortSignal: AbortSignal.timeout(qvacRequestTimeoutMs()),
          maxRetries: 0,
        });
        responseText = generated.text;
        modelUsage = generated.usage;
        try {
          response = validateCausalGenerationResponse(responseText, arm);
          status = "completed";
        } catch (error) {
          status = "rejected";
          rawError = error instanceof Error ? error.message : String(error);
        }
      } catch (error) {
        rawError = error instanceof Error ? error.message : String(error);
      }
      results.push({
        caseId: causalCase.caseId,
        armId: arm.id,
        status,
        response,
        responseText,
        rawError,
        latencyMs: performance.now() - started,
        modelUsage,
        contextDocumentCount: arm.documents.length,
        contextTokenBudget: arm.contextTokenCount,
        contextDocumentIds: arm.documents.map((document) => document.id),
        removedDocumentIds: arm.removedDocumentIds,
        replacementDocumentIds: arm.replacementDocumentIds,
        frozenHydraQueryIds: arm.hydraQueryIds,
        hydraQueryCount: arm.hydraQueryIds.length,
        promptTemplateSha256: request.promptTemplateSha256,
        budgetPaddingTokens,
      });
      if (results.length % 10 === 0) console.log(JSON.stringify({ completedAttempts: results.length, totalAttempts: runtime.cases.length * 10 }));
    }
  }
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtimeSha256: createHash("sha256").update(runtimeBytes).digest("hex"),
    parityCalibrationSha256,
    labelsOpened: false,
    model: { provider: "@qvac/ai-sdk-provider", baseUrl, model: modelName, temperature: 0, maxOutputTokens: 220, timeoutMs: qvacRequestTimeoutMs(), maxRetries: 0 },
    summary: {
      cases: runtime.cases.length,
      arms: 10,
      attempts: results.length,
      completed: results.filter((row) => row.status === "completed").length,
      rejected: results.filter((row) => row.status === "rejected").length,
      failed: results.filter((row) => row.status === "failed").length,
      promptTemplateHashes: [...new Set(results.map((row) => row.promptTemplateSha256))],
      contextDocumentCounts: [...new Set(results.map((row) => row.contextDocumentCount))],
    },
    results,
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...artifact.summary, labelsOpened: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
