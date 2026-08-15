import { createQvac } from "@qvac/ai-sdk-provider";
import { generateText } from "ai";

import { QVAC_MODEL_ALIAS } from "./model";

export const ERB_ANSWER_EVALUATION_PROMPT_VERSION =
  "erb-answer-evaluation-v1" as const;

export interface EvaluationJudgeDecision {
  correct: boolean;
  completeness: number;
  satisfiedFactIndexes: number[];
  reason: string;
}

export interface EvaluationJudgeInput {
  questionId: string;
  question: string;
  goldAnswer: string;
  answerFacts: string[];
  candidateAnswer: string;
}

export interface EvaluationJudgeResult {
  decision: EvaluationJudgeDecision;
  rawOutput: string;
  latencyMs: number;
  model: string;
  promptVersion: typeof ERB_ANSWER_EVALUATION_PROMPT_VERSION;
}

export class EvaluationJudgeMalformedOutputError extends Error {
  constructor(
    message: string,
    readonly rawOutput: string,
    readonly latencyMs: number,
  ) {
    super(message);
    this.name = "EvaluationJudgeMalformedOutputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEvaluationJudgeResponse(
  responseText: string,
  factCount: number,
): EvaluationJudgeDecision {
  let value: unknown;
  try {
    value = JSON.parse(responseText);
  } catch {
    throw new TypeError("Judge response is not one JSON object");
  }
  const keys = isRecord(value) ? Object.keys(value).sort() : [];
  if (
    !isRecord(value) ||
    keys.join("\u0000") !==
      ["completeness", "correct", "reason", "satisfiedFactIndexes"].join("\u0000") ||
    typeof value.correct !== "boolean" ||
    typeof value.completeness !== "number" ||
    !Number.isFinite(value.completeness) ||
    value.completeness < 0 ||
    value.completeness > 1 ||
    !Array.isArray(value.satisfiedFactIndexes) ||
    typeof value.reason !== "string" ||
    value.reason.trim().length === 0
  ) {
    throw new TypeError("Judge response has an invalid schema");
  }
  const indexes = value.satisfiedFactIndexes;
  if (
    !indexes.every(
      (index) =>
        Number.isSafeInteger(index) && Number(index) >= 0 && Number(index) < factCount,
    ) ||
    new Set(indexes).size !== indexes.length
  ) {
    throw new TypeError("Judge response has invalid fact indexes");
  }
  return {
    correct: value.correct,
    completeness: value.completeness,
    satisfiedFactIndexes: [...indexes].map(Number).sort((left, right) => left - right),
    reason: value.reason.trim(),
  };
}

export class QvacEvaluationJudge {
  constructor(
    private readonly baseUrl = process.env.QVAC_BASE_URL ??
      "http://127.0.0.1:11436/v1",
    private readonly model = QVAC_MODEL_ALIAS,
  ) {}

  async evaluate(input: EvaluationJudgeInput): Promise<EvaluationJudgeResult> {
    if (this.model !== QVAC_MODEL_ALIAS) {
      throw new TypeError(`ERB judge requires pinned model alias ${QVAC_MODEL_ALIAS}`);
    }
    const qvac = createQvac({
      baseURL: this.baseUrl.replace(/\/$/, ""),
      apiKey: process.env.QVAC_API_KEY ?? "local-loopback-only",
    });
    const started = performance.now();
    const { text: rawOutput } = await generateText({
      model: qvac(this.model),
      abortSignal: AbortSignal.timeout(120_000),
      temperature: 0,
      maxOutputTokens: 180,
      system:
        'Evaluate the candidate answer only against the supplied reference answer and numbered facts. Return exactly one minified JSON object with exactly these keys: {"correct":BOOLEAN,"completeness":NUMBER_0_TO_1,"satisfiedFactIndexes":[ZERO_BASED_INTEGERS],"reason":"SHORT REASON"}. Correct means the candidate answers the question without a material contradiction. Completeness is the fraction of required facts substantively present. Do not add markdown.',
      prompt: JSON.stringify({
        promptVersion: ERB_ANSWER_EVALUATION_PROMPT_VERSION,
        questionId: input.questionId,
        question: input.question,
        referenceAnswer: input.goldAnswer,
        requiredFacts: input.answerFacts.map((fact, index) => ({ index, fact })),
        candidateAnswer: input.candidateAnswer,
      }),
    });
    const latencyMs = Number((performance.now() - started).toFixed(3));
    try {
      return {
        decision: parseEvaluationJudgeResponse(rawOutput, input.answerFacts.length),
        rawOutput,
        latencyMs,
        model: this.model,
        promptVersion: ERB_ANSWER_EVALUATION_PROMPT_VERSION,
      };
    } catch (error) {
      throw new EvaluationJudgeMalformedOutputError(
        error instanceof Error ? error.message : String(error),
        rawOutput,
        latencyMs,
      );
    }
  }
}
