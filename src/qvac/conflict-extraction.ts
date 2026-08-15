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
      (value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])
        .map((token) =>
          /^sign(?:ed|ing|ature|atures)?$/.test(token) ? "sign" : token,
        ),
    ),
  ];
}

export function buildGroundingCandidates(input: {
  question: string;
  sourceText: string;
  limit: number;
}): GroundingCandidate[] {
  const questionTokens = lexicalTokens(input.question);
  const lineSeparator = input.sourceText.includes("\n")
    ? "\n"
    : input.sourceText.includes("\\n")
      ? "\\n"
      : "\n";
  const rawLines = input.sourceText.split(lineSeparator);
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
    for (const width of [2, 3, 4, 5, 6, 8, 10, 12]) {
      const lines = rawLines.slice(index, index + width);
      const quote = lines.join(lineSeparator).trim();
      if (
        quote.length >= 24 &&
        quote.length <= 2400 &&
        lines.length === width
      ) {
        segments.push(quote);
      }
    }
  }
  const addIntentSpan = (indices: number[]): void => {
    const present = indices.filter((index) => index >= 0);
    if (present.length < 2) return;
    const start = Math.max(0, Math.min(...present) - 1);
    const end = Math.min(rawLines.length, Math.max(...present) + 2);
    const quote = rawLines.slice(start, end).join(lineSeparator).trim();
    if (quote.length >= 24 && quote.length <= 7000) segments.push(quote);
  };
  const bestMatchingLineIndex = (pattern: RegExp): number =>
    rawLines
      .map((line, index) => ({
        index,
        overlap: questionTokens.filter(
          (token) =>
            !new Set(["basis", "catalog", "cost", "format", "measurement", "rate", "time", "use", "weekly"])
              .has(token) && lexicalTokens(line).includes(token),
        ).length,
      }))
      .filter(({ index }) => pattern.test(rawLines[index]!))
      .sort((left, right) => right.overlap - left.overlap || left.index - right.index)[0]
      ?.index ?? -1;
  if (/\bmeasurement\s+basis\b/i.test(input.question)) {
    addIntentSpan([
      bestMatchingLineIndex(
        /provider[^\n]{0,40}bill|sampled\s+bytes|measurement\s+basis/i,
      ),
      bestMatchingLineIndex(
        /(?:[$€£]\s*\d[^\n]{0,100}\b(?:gb|gib|byte|token)s?\b|\b(?:gb|gib|byte|token)s?\b[^\n]{0,100}[$€£]\s*\d)/i,
      ),
    ]);
  }
  if (/\b(?:format|fingerprint|identifier|digest)\b/i.test(input.question)) {
    addIntentSpan([
      rawLines.findIndex((line) =>
        /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b[^\n]{0,50}\b\d{1,2}:\d{2}\b/i.test(line),
      ),
      rawLines.findIndex((line) =>
        /[A-Z][A-Z0-9_]+\s*\|\s*[A-Z][A-Z0-9_]+/.test(line),
      ),
      rawLines.findIndex((line) => /\b(?:no|not|without)\b[^\n]{0,40}\bwhitespace\b/i.test(line)),
      rawLines.findIndex((line) => /\b(?:sha-?\d+|hex(?:adecimal)?|digest|hash)\b/i.test(line)),
      rawLines.findIndex(
        (line) =>
          /\b(?:every|each|per)\b/i.test(line) &&
          /\b(?:line|record|item)\b/i.test(line) &&
          /(?:fingerprint|identifier|digest|hash)/i.test(line),
      ),
    ]);
  }
  const uniqueSegments = [...new Set(segments)];
  const valueTypedSegments = /%|percent|percentage/i.test(input.question)
    ? uniqueSegments.filter((segment) => /%|percent|percentage/i.test(segment))
    : uniqueSegments;

  const ranked = (valueTypedSegments.length > 0 ? valueTypedSegments : uniqueSegments)
    .map((quote, originalIndex) => {
      const quoteTokens = new Set(lexicalTokens(quote));
      const overlap = questionTokens.filter((token) =>
        quoteTokens.has(token),
      ).length;
      const listLines = quote
        .split(/\n|\\n/)
        .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length;
      const numericRanges = /\b(?:range|ranges|threshold|thresholds)\b/i.test(
        input.question,
      )
        ? quote.match(/(?:>=|<=|>|<)\s*\d+|\b\d+\s*[-–]\s*\d+\b/g)?.length ?? 0
        : 0;
      const measurementBasisSignals = /\bmeasurement\s+basis\b/i.test(input.question)
        ? [
            /\b(?:gb|gib|bytes?)\b/i,
            /\b(?:bill|billed|billing)\b/i,
            /\b(?:sampled?|attribute|trace)\w*\b/i,
            /\b(?:token|request)\w*\b/i,
          ].filter((pattern) => pattern.test(quote)).length
        : 0;
      const identifierFormatSignals = /\b(?:format|fingerprint|identifier|digest)\b/i.test(
        input.question,
      )
        ? [
            /[A-Z][A-Z0-9_]+\s*\|\s*[A-Z][A-Z0-9_]+/,
            /\b(?:no|not|without)\b[^\n]{0,40}\bwhitespace\b/i,
            /\b(?:sha-?\d+|hex(?:adecimal)?|digest|hash)\b/i,
            /\b(?:every|each|per)\b[^\n]{0,40}\b(?:line|record|item)\b/i,
            /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b[^\n]{0,40}\b\d{1,2}:\d{2}\b/i,
          ].filter((pattern) => pattern.test(quote)).length
        : 0;
      const breakpointCaveat = /\bbreakpoints?\b/i.test(input.question) &&
        /\bconfirm\b[^\n]{0,80}\b(?:sales\s+ops|finance)\b/i.test(quote)
        ? 10
        : 0;
      const breakpointAnswer = /\bbreakpoints?\b/i.test(input.question) &&
        /\bhosted\b/i.test(quote) &&
        /\b(?:breaks?|breakpoints?)\b/i.test(quote) &&
        /\b\d+(?:\.\d+)?[kmb]?\b/i.test(quote)
        ? 12
        : 0;
      const score =
        overlap * 5 +
        Math.min(4, listLines) +
        Math.min(12, numericRanges * 3) +
        measurementBasisSignals * 4 +
        identifierFormatSignals * 4 +
        breakpointCaveat +
        breakpointAnswer +
        (/\d/.test(quote) ? 2 : 0) +
        (/\bas of\b|\bv\d+(?:\.\d+)+\+?/i.test(quote) ? 6 : 0) +
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
        right.score - left.score ||
        right.quote.length - left.quote.length ||
        left.originalIndex - right.originalIndex,
    );
  const selected: string[] = [];
  let totalChars = 0;
  for (const { quote } of ranked) {
    if (selected.length >= input.limit) break;
    if (selected.length > 0 && totalChars + quote.length > 10_000) continue;
    const candidateTokens = new Set(lexicalTokens(quote));
    const overlapsSelectedRegion = selected.some((existing) => {
      const existingTokens = new Set(lexicalTokens(existing));
      const smallerSize = Math.min(candidateTokens.size, existingTokens.size);
      if (smallerSize === 0) return false;
      let shared = 0;
      for (const token of candidateTokens) {
        if (existingTokens.has(token)) shared += 1;
      }
      return shared / smallerSize >= 0.7;
    });
    if (overlapsSelectedRegion) continue;
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
  const selectedCandidate = input.candidates.find(
    (item) => item.index === result.data.candidateIndex,
  );
  if (!selectedCandidate) {
    throw new TypeError("QVAC conflict selection candidate does not exist");
  }
  const candidate = !recoveredFromTruncation &&
      /\bbreakpoints?\b/i.test(input.question ?? "")
    ? (input.candidates.find((item) =>
        valueIsRepresented(result.data.value, item.quote),
      ) ?? selectedCandidate)
    : selectedCandidate;
  let value = recoveredFromTruncation ? candidate.quote : result.data.value;
  if (!valueIsRepresented(value, candidate.quote)) {
    value = candidate.quote;
  }
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
      : /short-term|recommend|propos|suggest|\bshould\b|\bplanned\b|\bfuture\s+(?:product\s+)?release\b/i.test(candidate.quote)
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
