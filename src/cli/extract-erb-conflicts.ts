import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stableId } from "@/domain/ids";
import {
  assertNoEvaluationLabels,
  parseRuntimeManifest,
  type RuntimeConflictManifestCase,
} from "@/evaluation/erb-conflict-runtime";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import {
  buildGroundingCandidates,
  type ConflictExtractionObservation,
  validateConflictSelection,
} from "@/qvac/conflict-extraction";
import {
  QvacClient,
  QvacConflictExtractionError,
} from "@/qvac/client";
import { qvacRuntimeModel } from "@/qvac/model";

interface ExtractErbConflictArgs {
  documents: string;
  manifest: string;
  output: string;
  limit: number;
}

export type RuntimeConflictCase = RuntimeConflictManifestCase;

export interface CandidateDocument {
  sourceObjectId: string;
  sourceNativeId: string;
  sourceSystem: string;
  title: string;
  body: string;
  payloadDigest: string;
}

export interface ExtractionRecord {
  cacheKey: string;
  questionId: string;
  sourceObjectId: string;
  sourceNativeId: string;
  sourceSystem: string;
  sourceTitle: string;
  sourceDigest: string;
  status: "accepted" | "rejected";
  observation?: ConflictExtractionObservation;
  error?: string;
  responseText: string;
  latencyMs: number;
  cached: boolean;
}

const usage =
  "Usage: npm run extract:erb-conflicts -- --documents <path> --manifest <path> --output <path> --limit <positive integer>";
const promptVersion = "conflict-observation-v13";
const model = process.env.QVAC_MODEL ?? "sourcetruce-extractor";
const stopWords = new Set([
  "about",
  "after",
  "does",
  "from",
  "have",
  "how",
  "into",
  "should",
  "that",
  "than",
  "the",
  "their",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

export function parseExtractErbConflictArgs(
  args: string[],
): ExtractErbConflictArgs {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--documents",
    "--manifest",
    "--output",
    "--limit",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || !value || values.has(flag)) {
      throw new TypeError(usage);
    }
    values.set(flag, value);
  }
  const documents = values.get("--documents");
  const manifest = values.get("--manifest");
  const output = values.get("--output");
  const limitValue = values.get("--limit");
  const limit = limitValue ? Number(limitValue) : Number.NaN;
  if (
    !documents ||
    !manifest ||
    !output ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  ) {
    throw new TypeError(usage);
  }
  return { documents, manifest, output, limit };
}

export function toRuntimeConflictCase(raw: unknown): RuntimeConflictCase {
  try {
    return parseRuntimeManifest({
      schemaVersion: 1,
      promptVersion,
      cases: [raw],
    }).cases[0]!;
  } catch (error) {
    if (error instanceof TypeError && /evaluation label/i.test(error.message)) {
      throw error;
    }
    throw new TypeError("ERB conflict case has an invalid runtime shape");
  }
}

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(/[a-z0-9][a-z0-9_-]{2,}/g)
        ?.filter((token) => !stopWords.has(token))
        .map((token) =>
          token.length > 4 && token.endsWith("s") && !token.endsWith("ss")
            ? token.slice(0, -1)
            : token,
        ) ?? [],
    ),
  ];
}

function queriedLiteralAnchors(question: string): string[] {
  return [
    ...new Set(
      question
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(/\b\d+(?:\.\d+)?(?:h|hr|hrs|hours?|d|days?|%|gb|gib|tokens?)?\b/g) ?? [],
    ),
  ];
}

function contradictedAnchorCount(body: string, anchors: string[]): number {
  const normalized = body.normalize("NFKC").toLocaleLowerCase("en-US");
  let count = 0;
  for (const anchor of anchors) {
    let offset = normalized.indexOf(anchor);
    while (offset >= 0) {
      const context = normalized.slice(Math.max(0, offset - 40), offset + anchor.length + 40);
      if (/\b(?:not|deprecated|superseded|previous(?:ly)?|formerly)\b|updated\s+from/.test(context)) {
        count += 1;
      }
      offset = normalized.indexOf(anchor, offset + anchor.length);
    }
  }
  return count;
}

export function rankCandidateDocuments(
  runtimeCase: RuntimeConflictCase,
  documents: CandidateDocument[],
  limit: number,
): CandidateDocument[] {
  const questionTokens = tokens(runtimeCase.question);
  const literalAnchors = queriedLiteralAnchors(runtimeCase.question);
  const ranked = documents
    .filter((document) => runtimeCase.sourceTypes.includes(document.sourceSystem))
    .map((document) => {
      const title = document.title.toLocaleLowerCase("en-US");
      const body = document.body.toLocaleLowerCase("en-US");
      const titleTokens = new Set(tokens(document.title));
      const bodyTokens = new Set(tokens(document.body));
      const score = questionTokens.reduce(
        (total, token) =>
          total +
          (titleTokens.has(token) || title.includes(token) ? 5 : 0) +
          (bodyTokens.has(token) || body.includes(token) ? 1 : 0),
        0,
      ) - contradictedAnchorCount(document.body, literalAnchors) * 8;
      return { document, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.sourceObjectId.localeCompare(right.document.sourceObjectId),
    )
  const selected = new Map<string, (typeof ranked)[number]>();
  for (const sourceSystem of runtimeCase.sourceTypes) {
    const best = ranked.find((item) => item.document.sourceSystem === sourceSystem);
    if (best && selected.size < limit) selected.set(best.document.sourceObjectId, best);
  }
  for (const item of ranked) {
    if (selected.size >= limit) break;
    selected.set(item.document.sourceObjectId, item);
  }
  return [...selected.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.sourceObjectId.localeCompare(right.document.sourceObjectId),
    )
    .map(({ document }) => document);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function subjectHint(runtimeCase: RuntimeConflictCase): string {
  return (
    runtimeCase.question.match(/\b[a-z]+-\d+(?:-[a-z0-9]+)+\b/i)?.[0] ??
    runtimeCase.questionId
  );
}

export function revalidateCachedExtraction(input: {
  runtimeCase: RuntimeConflictCase;
  document: CandidateDocument;
  cached: ExtractionRecord;
}): ExtractionRecord {
  try {
    const observation = validateConflictSelection({
      responseText: input.cached.responseText,
      candidates: buildGroundingCandidates({
        question: input.runtimeCase.question,
        sourceText: input.document.body,
        limit: 8,
      }),
      sourceText: input.document.body,
      question: input.runtimeCase.question,
      subject: subjectHint(input.runtimeCase),
      predicate: "conflict_answer",
    });
    return {
      ...input.cached,
      status: "accepted",
      observation,
      error: undefined,
      cached: true,
    };
  } catch (error) {
    return {
      ...input.cached,
      status: "rejected",
      observation: undefined,
      error: error instanceof Error ? error.message : String(error),
      cached: true,
    };
  }
}

async function loadConflictCases(manifestPath: string): Promise<RuntimeConflictCase[]> {
  const body = await readFile(path.resolve(manifestPath), "utf8");
  const manifest = parseRuntimeManifest(JSON.parse(body) as unknown);
  if (manifest.promptVersion !== promptVersion) {
    throw new TypeError("Runtime manifest prompt version does not match extractor");
  }
  return manifest.cases;
}

async function loadDocuments(documentsPath: string): Promise<CandidateDocument[]> {
  const documents: CandidateDocument[] = [];
  for await (const event of new ErbAdapter().read(documentsPath)) {
    if (event.type !== "record") continue;
    const title = event.record.fields.title;
    const body = event.record.fields.body;
    if (typeof title !== "string" || typeof body !== "string") {
      throw new TypeError(`Normalized ERB record is missing text: ${event.record.id}`);
    }
    documents.push({
      sourceObjectId: event.record.id,
      sourceNativeId: event.record.sourceNativeId,
      sourceSystem: event.record.sourceSystem,
      title,
      body,
      payloadDigest: event.record.payloadDigest,
    });
  }
  return documents;
}

async function loadExistingCache(
  outputPath: string,
): Promise<Map<string, ExtractionRecord>> {
  try {
    const parsed = JSON.parse(await readFile(outputPath, "utf8")) as {
      cases?: Array<{ extractions?: ExtractionRecord[] }>;
    };
    return new Map(
      (parsed.cases ?? [])
        .flatMap((item) => item.extractions ?? [])
        .map((item) => [item.cacheKey, item]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseExtractErbConflictArgs(process.argv.slice(2));
  const outputPath = path.resolve(options.output);
  const runtimeModel = qvacRuntimeModel(model);
  const [runtimeCases, documents, cache] = await Promise.all([
    loadConflictCases(options.manifest),
    loadDocuments(options.documents),
    loadExistingCache(outputPath),
  ]);
  const client = new QvacClient();
  const cases = [];

  for (const runtimeCase of runtimeCases.slice(0, options.limit)) {
    const candidates = rankCandidateDocuments(
      runtimeCase,
      documents,
      runtimeCase.maximumDocuments,
    );
    const extractions: ExtractionRecord[] = [];
    for (const document of candidates) {
      const cacheKey = stableId("qvac_cache", {
        questionDigest: sha256(runtimeCase.question),
        sourceDigest: document.payloadDigest,
        model,
        promptVersion,
      });
      const cached = cache.get(cacheKey);
      if (cached) {
        extractions.push(
          revalidateCachedExtraction({ runtimeCase, document, cached }),
        );
        continue;
      }
      const started = performance.now();
      try {
        const request = {
          questionId: runtimeCase.questionId,
          question: runtimeCase.question,
          sourceObjectId: document.sourceObjectId,
          sourceSystem: document.sourceSystem,
          sourceNativeId: document.sourceNativeId,
          sourceTitle: document.title,
          sourceText: document.body,
          subjectHint: subjectHint(runtimeCase),
        };
        assertNoEvaluationLabels(request);
        const result = await client.extractConflictObservation(request);
        extractions.push({
          cacheKey,
          questionId: runtimeCase.questionId,
          sourceObjectId: document.sourceObjectId,
          sourceNativeId: document.sourceNativeId,
          sourceSystem: document.sourceSystem,
          sourceTitle: document.title,
          sourceDigest: document.payloadDigest,
          status: "accepted",
          observation: result.observation,
          responseText: result.responseText,
          latencyMs: Number((performance.now() - started).toFixed(3)),
          cached: false,
        });
      } catch (error) {
        extractions.push({
          cacheKey,
          questionId: runtimeCase.questionId,
          sourceObjectId: document.sourceObjectId,
          sourceNativeId: document.sourceNativeId,
          sourceSystem: document.sourceSystem,
          sourceTitle: document.title,
          sourceDigest: document.payloadDigest,
          status: "rejected",
          error: error instanceof Error ? error.message : String(error),
          responseText:
            error instanceof QvacConflictExtractionError
              ? error.responseText
              : "",
          latencyMs: Number((performance.now() - started).toFixed(3)),
          cached: false,
        });
      }
    }
    cases.push({
      ...runtimeCase,
      questionDigest: sha256(runtimeCase.question),
      candidateSelection: {
        algorithm: "source-diverse-lexical-v2",
        maximumDocuments: runtimeCase.maximumDocuments,
        selectedSourceObjectIds: candidates.map(
          (candidate) => candidate.sourceObjectId,
        ),
      },
      extractions,
    });
  }

  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      provider: "@qvac/ai-sdk-provider",
      transport: "Vercel AI SDK over local QVAC HTTP",
      baseUrl: process.env.QVAC_BASE_URL ?? "http://127.0.0.1:11436/v1",
      model,
      modelSource: runtimeModel.modelSource,
      modelDownloadUrl: runtimeModel.downloadUrl,
      modelSha256: runtimeModel.modelSha256,
      modelExpectedBytes: runtimeModel.expectedBytes,
      modelDisplayName: runtimeModel.displayName,
      modelParameters: runtimeModel.parameters,
      modelQuantization: runtimeModel.quantization,
      promptVersion,
    },
    input: {
      documentsPath: path.resolve(options.documents),
      manifestPath: path.resolve(options.manifest),
      documentCount: documents.length,
      questionLimit: options.limit,
    },
    cases,
  };
  const serialized = JSON.stringify(artifact, null, 2);
  if (/expected_doc_ids|gold_answer|answer_facts/.test(serialized)) {
    throw new Error("Runtime extraction artifact contains evaluation labels");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serialized}\n`, "utf8");
  console.log(
    JSON.stringify({
      outputPath,
      cases: cases.length,
      accepted: cases.flatMap((item) => item.extractions).filter(
        (item) => item.status === "accepted",
      ).length,
      rejected: cases.flatMap((item) => item.extractions).filter(
        (item) => item.status === "rejected",
      ).length,
    }),
  );
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
