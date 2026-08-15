import { z } from "zod";

const lifecycleSchema = z.enum([
  "proposal",
  "approved",
  "applied",
  "deprecated",
  "unknown",
]);

const responseSchema = z
  .object({
    subject: z.string().trim().min(1),
    predicate: z.string().trim().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
    evidenceQuote: z.string().min(1),
    observedAt: z.string().trim().min(1).optional(),
    lifecycle: lifecycleSchema,
  })
  .strict();

export interface ConflictExtractionObservation {
  subject: string;
  predicate: string;
  value: string | number | boolean;
  evidenceQuote: string;
  observedAt?: string;
  lifecycle: z.infer<typeof lifecycleSchema>;
}

export interface GroundingCandidate {
  index: number;
  quote: string;
}

const selectionSchema = z
  .object({
    candidateIndex: z.number().int().nonnegative(),
    value: z.union([z.string().min(1), z.number(), z.boolean()]),
    lifecycle: lifecycleSchema.optional(),
  })
  .strict();

function jsonBody(text: string): string {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? withoutThinking).trim();
}

function normalizePredicate(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new TypeError("QVAC conflict extraction returned an invalid predicate");
  }
  return normalized;
}

function valueIsRepresented(
  value: string | number | boolean,
  evidenceQuote: string,
): boolean {
  if (typeof value === "string") {
    const normalizedValue = value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-US");
    const normalizedQuote = evidenceQuote
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-US");
    return normalizedValue.length > 0 && normalizedQuote.includes(normalizedValue);
  }
  const literal = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9.])${literal}([^a-z0-9.]|$)`, "i").test(
    evidenceQuote,
  );
}

function lexicalTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [],
    ),
  ];
}

export function buildGroundingCandidates(input: {
  question: string;
  sourceText: string;
  limit: number;
}): GroundingCandidate[] {
  const questionTokens = lexicalTokens(input.question);
  const rawLines = input.sourceText.split("\n");
  const baseSegments = rawLines
    .flatMap((line) =>
      line.length > 900
        ? (line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [line])
        : [line],
    )
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 12);
  const segments = [...baseSegments];
  for (let index = 0; index < rawLines.length; index += 1) {
    for (const width of [2, 3, 5, 8]) {
      const lines = rawLines.slice(index, index + width);
      const quote = lines.join("\n").trim();
      if (
        quote.length >= 24 &&
        quote.length <= 2400 &&
        lines.length === width
      ) {
        segments.push(quote);
      }
    }
  }
  const uniqueSegments = [...new Set(segments)];
  const valueTypedSegments = /%|percent|percentage/i.test(input.question)
    ? uniqueSegments.filter((segment) => /%|percent|percentage/i.test(segment))
    : uniqueSegments;

  const ranked = (valueTypedSegments.length > 0 ? valueTypedSegments : uniqueSegments)
    .map((quote, originalIndex) => {
      const lowered = quote.toLocaleLowerCase("en-US");
      const overlap = questionTokens.filter((token) =>
        lowered.includes(token),
      ).length;
      const listLines = quote
        .split("\n")
        .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length;
      const score =
        overlap * 4 +
        Math.min(8, listLines * 2) +
        (/\d/.test(quote) ? 2 : 0) +
        (/%|percent|percentage/i.test(quote) ? 3 : 0) +
        (/propos|approv|appl|deploy|updat|deprecated|earlier|current/i.test(
          quote,
        )
          ? 2
          : 0);
      return { quote, originalIndex, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.originalIndex - right.originalIndex,
    );
  const selected: string[] = [];
  let totalChars = 0;
  for (const { quote } of ranked) {
    if (selected.length >= input.limit) break;
    if (selected.length > 0 && totalChars + quote.length > 10_000) continue;
    selected.push(quote);
    totalChars += quote.length;
  }
  return selected.map((quote, index) => ({ index, quote }));
}

export function validateConflictSelection(input: {
  responseText: string;
  candidates: GroundingCandidate[];
  sourceText: string;
  question?: string;
  subject: string;
  predicate: string;
}): ConflictExtractionObservation {
  let parsed: unknown;
  let recoveredFromTruncation = false;
  const body = jsonBody(input.responseText);
  try {
    const repairedTrailingComma = body.replace(
      /,\s*}$/,
      "}",
    );
    parsed = JSON.parse(repairedTrailingComma) as unknown;
  } catch {
    const indexes = [...body.matchAll(/"candidateIndex"\s*:\s*(\d+)/g)];
    if (indexes.length !== 1) {
      throw new TypeError("QVAC conflict selection returned invalid JSON");
    }
    parsed = { candidateIndex: Number(indexes[0]![1]), value: "recovered" };
    recoveredFromTruncation = true;
  }
  const result = selectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new TypeError("QVAC conflict selection returned an invalid schema");
  }
  const candidate = input.candidates.find(
    (item) => item.index === result.data.candidateIndex,
  );
  if (!candidate) {
    throw new TypeError("QVAC conflict selection candidate does not exist");
  }
  let value = recoveredFromTruncation ? candidate.quote : result.data.value;
  if (
    typeof value === "string" &&
    value.trim() === candidate.quote.trim() &&
    /%|percent|percentage/i.test(input.question ?? "")
  ) {
    const percentages = candidate.quote.match(/\b\d+(?:\.\d+)?%/g) ?? [];
    if (percentages.length === 1) value = percentages[0];
  }
  const quoteLifecycle =
    /updat|\bapplied\b|deploy|\bcurrent\b|effective|\bfinal\b/i.test(
      candidate.quote,
    )
      ? "applied"
      : /short-term|recommend|propos|suggest|\bshould\b/i.test(candidate.quote)
        ? "proposal"
        : (recoveredFromTruncation ? "unknown" : (result.data.lifecycle ?? "unknown"));
  return validateConflictObservation({
    responseText: JSON.stringify({
      subject: input.subject,
      predicate: input.predicate,
      value,
      lifecycle: quoteLifecycle,
      evidenceQuote: candidate.quote,
    }),
    sourceText: input.sourceText,
  });
}

export function validateConflictObservation(input: {
  responseText: string;
  sourceText: string;
}): ConflictExtractionObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(input.responseText)) as unknown;
  } catch {
    throw new TypeError("QVAC conflict extraction returned invalid JSON");
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    throw new TypeError("QVAC conflict extraction returned an invalid schema");
  }
  if (!input.sourceText.includes(result.data.evidenceQuote)) {
    throw new TypeError("QVAC conflict extraction quote is not in the source");
  }
  if (!valueIsRepresented(result.data.value, result.data.evidenceQuote)) {
    throw new TypeError("QVAC conflict extraction value is not in its quote");
  }
  return {
    ...result.data,
    predicate: normalizePredicate(result.data.predicate),
  };
}
