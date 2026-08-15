import { createHash } from "node:crypto";

import { normalizeAnswerValue } from "@/conflicts/promote-erb-conflict";

const forbiddenLabel = /expected[_-]?doc[_-]?ids|gold[_-]?answer|answer[_-]?facts/i;

export interface RuntimeConflictManifestCase {
  questionId: string;
  question: string;
  questionType: "conflicting_info";
  sourceTypes: string[];
  maximumDocuments: number;
}

export interface RuntimeConflictManifest {
  schemaVersion: 1;
  promptVersion: string;
  cases: RuntimeConflictManifestCase[];
}

export interface ConflictExtractionRecord {
  sourceObjectId: string;
  sourceNativeId: string;
  status: "accepted" | "rejected";
  observation?: { value: unknown; evidenceQuote?: string };
  error?: string;
  latencyMs: number;
}

export interface ConflictExtractionArtifact {
  schemaVersion: number;
  runtime: { model: string; promptVersion: string; [key: string]: unknown };
  cases: Array<{
    questionId: string;
    question: string;
    sourceTypes: string[];
    candidateSelection: {
      maximumDocuments: number;
      selectedSourceObjectIds: string[];
      [key: string]: unknown;
    };
    extractions: ConflictExtractionRecord[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export type ConflictPromotion =
  | {
      questionId: string;
      status: "resolved";
      winningValue: string;
      [key: string]: unknown;
    }
  | {
      questionId: string;
      status: "unresolved";
      winningValue: null;
      [key: string]: unknown;
    }
  | {
      questionId: string;
      status: "skipped";
      reason: string;
      [key: string]: unknown;
    };

export interface FrozenConflictCase {
  questionId: string;
  question: string;
  questionType: "conflicting_info";
  status: "completed" | "rejected" | "failed";
  verdict: "SUPPORTED" | "DISPUTED" | null;
  answer: string | null;
  evidenceDocumentIds: string[];
  selectedSourceObjectIds: string[];
  latencyMs: number;
  failureReason: string | null;
  extractionFailures: Array<{ sourceNativeId: string; error: string }>;
}

export interface FrozenConflictRuntime {
  schemaVersion: 1;
  manifestDigest: string;
  runtime: { model: string; promptVersion: string };
  summary: {
    attempted: number;
    completed: number;
    rejected: number;
    failed: number;
  };
  cases: FrozenConflictCase[];
  digest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNoEvaluationLabels(value: unknown): void {
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      if (forbiddenLabel.test(item)) {
        throw new TypeError("Runtime value contains an evaluation label");
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    for (const [key, nested] of Object.entries(item)) {
      if (forbiddenLabel.test(key)) {
        throw new TypeError("Runtime value contains an evaluation label");
      }
      visit(nested);
    }
  };
  visit(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function uniqueMap<T extends { questionId: string }>(
  items: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item.questionId || result.has(item.questionId)) {
      throw new TypeError(`${label} contains a missing or duplicate question ID`);
    }
    result.set(item.questionId, item);
  }
  return result;
}

export function parseRuntimeManifest(value: unknown): RuntimeConflictManifest {
  assertNoEvaluationLabels(value);
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.promptVersion !== "string" || !Array.isArray(value.cases)) {
    throw new TypeError("ERB runtime manifest has an invalid envelope");
  }
  const cases = value.cases.map((item): RuntimeConflictManifestCase => {
    if (
      !isRecord(item) ||
      Object.keys(item).some(
        (key) =>
          !["questionId", "question", "questionType", "sourceTypes", "maximumDocuments"].includes(key),
      ) ||
      typeof item.questionId !== "string" ||
      typeof item.question !== "string" ||
      item.questionType !== "conflicting_info" ||
      !Array.isArray(item.sourceTypes) ||
      item.sourceTypes.length === 0 ||
      !item.sourceTypes.every((source) => typeof source === "string" && source.length > 0) ||
      !Number.isInteger(item.maximumDocuments) ||
      Number(item.maximumDocuments) < 1 ||
      Number(item.maximumDocuments) > 2
    ) {
      throw new TypeError("ERB runtime manifest case has an invalid shape");
    }
    return {
      questionId: item.questionId,
      question: item.question,
      questionType: "conflicting_info",
      sourceTypes: [...new Set(item.sourceTypes as string[])].sort(),
      maximumDocuments: Number(item.maximumDocuments),
    };
  });
  uniqueMap(cases, "ERB runtime manifest");
  return {
    schemaVersion: 1,
    promptVersion: value.promptVersion,
    cases: cases.sort((left, right) => left.questionId.localeCompare(right.questionId)),
  };
}

function extractionFailures(
  extractions: ConflictExtractionRecord[],
): Array<{ sourceNativeId: string; error: string }> {
  return extractions
    .filter((item) => item.status === "rejected")
    .map((item) => ({
      sourceNativeId: item.sourceNativeId,
      error: item.error?.trim() || "rejected extraction",
    }))
    .sort(
      (left, right) =>
        left.sourceNativeId.localeCompare(right.sourceNativeId) ||
        left.error.localeCompare(right.error),
    );
}

function failedCase(
  manifestCase: RuntimeConflictManifestCase,
  reason: string,
  selectedSourceObjectIds: string[] = [],
  latencyMs = 0,
  failures: Array<{ sourceNativeId: string; error: string }> = [],
): FrozenConflictCase {
  return {
    ...manifestCase,
    status: "failed",
    verdict: null,
    answer: null,
    evidenceDocumentIds: [],
    selectedSourceObjectIds,
    latencyMs,
    failureReason: reason,
    extractionFailures: failures,
  };
}

export function freezeConflictRuntime(input: {
  manifest: RuntimeConflictManifest;
  extraction: ConflictExtractionArtifact;
  promotions: ConflictPromotion[];
}): FrozenConflictRuntime {
  assertNoEvaluationLabels(input);
  const manifest = parseRuntimeManifest(input.manifest);
  if (
    !isRecord(input.extraction.runtime) ||
    typeof input.extraction.runtime.model !== "string" ||
    input.extraction.runtime.promptVersion !== manifest.promptVersion
  ) {
    throw new TypeError("Extraction runtime does not match the runtime manifest");
  }
  const extractionById = uniqueMap(input.extraction.cases, "Extraction artifact");
  const promotionById = uniqueMap(input.promotions, "Promotion artifact");

  const cases = manifest.cases.map((manifestCase): FrozenConflictCase => {
    const extraction = extractionById.get(manifestCase.questionId);
    const promotion = promotionById.get(manifestCase.questionId);
    if (!extraction) return failedCase(manifestCase, "missing extraction case");
    if (
      extraction.question !== manifestCase.question ||
      [...new Set(extraction.sourceTypes)].sort().join("\u0000") !==
        manifestCase.sourceTypes.join("\u0000")
    ) {
      return failedCase(manifestCase, "extraction case does not match runtime manifest");
    }
    const selectedSourceObjectIds = [
      ...new Set(extraction.candidateSelection.selectedSourceObjectIds),
    ].sort();
    const sortedExtractions = [...extraction.extractions].sort(
      (left, right) =>
        left.sourceNativeId.localeCompare(right.sourceNativeId) ||
        left.sourceObjectId.localeCompare(right.sourceObjectId),
    );
    const failures = extractionFailures(sortedExtractions);
    const latencyMs = Number(
      sortedExtractions
        .reduce(
          (total, item) =>
            total + (Number.isFinite(item.latencyMs) ? item.latencyMs : 0),
          0,
        )
        .toFixed(3),
    );
    if (
      extraction.candidateSelection.maximumDocuments !== manifestCase.maximumDocuments ||
      selectedSourceObjectIds.length > manifestCase.maximumDocuments
    ) {
      return failedCase(
        manifestCase,
        "candidate selection exceeds runtime manifest bound",
        selectedSourceObjectIds,
        latencyMs,
        failures,
      );
    }
    if (!promotion) {
      return failedCase(
        manifestCase,
        "missing promotion result",
        selectedSourceObjectIds,
        latencyMs,
        failures,
      );
    }
    if (promotion.status === "skipped") {
      const details = [promotion.reason, ...failures.map((failure) => failure.error)].join("; ");
      return {
        ...manifestCase,
        status: "rejected",
        verdict: null,
        answer: null,
        evidenceDocumentIds: [],
        selectedSourceObjectIds,
        latencyMs,
        failureReason: details,
        extractionFailures: failures,
      };
    }

    const accepted = sortedExtractions.filter(
      (item): item is ConflictExtractionRecord & { observation: { value: unknown } } =>
        item.status === "accepted" && isRecord(item.observation) && "value" in item.observation,
    );
    const values = [
      ...new Set(
        accepted
          .map((item) => item.observation.value)
          .filter(
            (value): value is string | number | boolean =>
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean",
          )
          .map((value) => String(normalizeAnswerValue(manifestCase.question, value))),
      ),
    ].sort((left, right) => left.localeCompare(right));
    const evidenceDocumentIds = [
      ...new Set(accepted.map((item) => item.sourceNativeId)),
    ].sort();
    const groundedQuotes = [
      ...new Set(
        accepted
          .map((item) => item.observation.evidenceQuote)
          .filter(
            (quote): quote is string =>
              typeof quote === "string" && quote.trim().length > 0,
          )
          .map((quote) => quote.trim()),
      ),
    ];
    if (promotion.status === "resolved") {
      if (!promotion.winningValue || !values.includes(promotion.winningValue)) {
        return failedCase(
          manifestCase,
          "resolved promotion has no grounded winning value",
          selectedSourceObjectIds,
          latencyMs,
          failures,
        );
      }
      const winningQuotes = accepted
        .filter(
          (item) => {
            const value = item.observation.value;
            return (
              (typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean") &&
              String(normalizeAnswerValue(manifestCase.question, value)) ===
                promotion.winningValue
            );
          },
        )
        .map((item) => item.observation.evidenceQuote)
        .filter(
          (quote): quote is string =>
            typeof quote === "string" && quote.trim().length > 0,
        )
        .map((quote) => quote.trim());
      const otherQuotes = groundedQuotes.filter(
        (quote) => !winningQuotes.includes(quote),
      );
      const answer = [
        `Grounded answer: ${promotion.winningValue}.`,
        winningQuotes.length
          ? `Controlling evidence: ${winningQuotes.join(" ")}`
          : "",
        otherQuotes.length
          ? `Earlier or conflicting evidence retained: ${otherQuotes.join(" ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        ...manifestCase,
        status: "completed",
        verdict: "SUPPORTED",
        answer,
        evidenceDocumentIds,
        selectedSourceObjectIds,
        latencyMs,
        failureReason: failures.length ? "one or more non-controlling extractions were rejected" : null,
        extractionFailures: failures,
      };
    }
    if (values.length < 2) {
      return failedCase(
        manifestCase,
        "unresolved promotion has fewer than two grounded values",
        selectedSourceObjectIds,
        latencyMs,
        failures,
      );
    }
    return {
      ...manifestCase,
      status: "completed",
      verdict: "DISPUTED",
      answer: [
        `The evidence remains disputed between ${values.join(" and ")}.`,
        groundedQuotes.length
          ? `Grounded source evidence: ${groundedQuotes.join(" ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      evidenceDocumentIds,
      selectedSourceObjectIds,
      latencyMs,
      failureReason: failures.length ? "one or more non-controlling extractions were rejected" : null,
      extractionFailures: failures,
    };
  });

  const withoutDigest = {
    schemaVersion: 1 as const,
    manifestDigest: canonicalDigest(manifest),
    runtime: {
      model: input.extraction.runtime.model,
      promptVersion: manifest.promptVersion,
    },
    summary: {
      attempted: cases.length,
      completed: cases.filter((item) => item.status === "completed").length,
      rejected: cases.filter((item) => item.status === "rejected").length,
      failed: cases.filter((item) => item.status === "failed").length,
    },
    cases,
  };
  const frozen = { ...withoutDigest, digest: canonicalDigest(withoutDigest) };
  assertNoEvaluationLabels(frozen);
  return frozen;
}

export function parseFrozenConflictRuntime(value: unknown): FrozenConflictRuntime {
  assertNoEvaluationLabels(value);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.manifestDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.manifestDigest) ||
    !isRecord(value.runtime) ||
    typeof value.runtime.model !== "string" ||
    typeof value.runtime.promptVersion !== "string" ||
    !isRecord(value.summary) ||
    !Array.isArray(value.cases) ||
    typeof value.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    throw new TypeError("Frozen runtime has an invalid envelope");
  }
  const cases = value.cases.map((item): FrozenConflictCase => {
    if (
      !isRecord(item) ||
      typeof item.questionId !== "string" ||
      typeof item.question !== "string" ||
      item.questionType !== "conflicting_info" ||
      !["completed", "rejected", "failed"].includes(String(item.status)) ||
      !["SUPPORTED", "DISPUTED", null].includes(item.verdict as "SUPPORTED" | "DISPUTED" | null) ||
      !(typeof item.answer === "string" || item.answer === null) ||
      !Array.isArray(item.evidenceDocumentIds) ||
      !item.evidenceDocumentIds.every((id) => typeof id === "string") ||
      !Array.isArray(item.selectedSourceObjectIds) ||
      !item.selectedSourceObjectIds.every((id) => typeof id === "string") ||
      typeof item.latencyMs !== "number" ||
      !Number.isFinite(item.latencyMs) ||
      item.latencyMs < 0 ||
      !(typeof item.failureReason === "string" || item.failureReason === null) ||
      !Array.isArray(item.extractionFailures) ||
      !item.extractionFailures.every(
        (failure) =>
          isRecord(failure) &&
          typeof failure.sourceNativeId === "string" &&
          typeof failure.error === "string",
      )
    ) {
      throw new TypeError("Frozen runtime contains an invalid case");
    }
    const status = item.status as FrozenConflictCase["status"];
    if (
      (status === "completed" &&
        (item.answer === null || !["SUPPORTED", "DISPUTED"].includes(String(item.verdict)))) ||
      (status !== "completed" && (item.answer !== null || item.verdict !== null))
    ) {
      throw new TypeError("Frozen runtime case status is inconsistent");
    }
    return item as unknown as FrozenConflictCase;
  });
  uniqueMap(cases, "Frozen runtime");
  const summary = value.summary as Record<string, unknown>;
  for (const key of ["attempted", "completed", "rejected", "failed"] as const) {
    if (!Number.isSafeInteger(summary[key]) || Number(summary[key]) < 0) {
      throw new TypeError("Frozen runtime has an invalid summary");
    }
  }
  const expectedSummary = {
    attempted: cases.length,
    completed: cases.filter((item) => item.status === "completed").length,
    rejected: cases.filter((item) => item.status === "rejected").length,
    failed: cases.filter((item) => item.status === "failed").length,
  };
  if (
    Object.entries(expectedSummary).some(
      ([key, count]) => summary[key] !== count,
    )
  ) {
    throw new TypeError("Frozen runtime summary does not match its cases");
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (canonicalDigest(withoutDigest) !== value.digest) {
    throw new TypeError("Frozen runtime digest does not match its contents");
  }
  return value as unknown as FrozenConflictRuntime;
}
