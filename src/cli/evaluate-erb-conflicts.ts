import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseFrozenConflictRuntime,
  type FrozenConflictRuntime,
} from "@/evaluation/erb-conflict-runtime";
import {
  scoreErbConflictRuntime,
  type ErbConflictLabel,
  type ErbJudgeOutcome,
} from "@/evaluation/erb-conflict-score";
import {
  ERB_ANSWER_EVALUATION_PROMPT_VERSION,
  EvaluationJudgeMalformedOutputError,
  QvacEvaluationJudge,
  type EvaluationJudgeInput,
  type EvaluationJudgeResult,
} from "@/qvac/evaluation-judge";
import { QVAC_MODEL_ALIAS } from "@/qvac/model";

export interface EvaluateErbConflictArgs {
  runtime: string;
  labels: string;
  output: string;
  answers: string;
}

interface EvaluationDependencies {
  readText: (file: string) => Promise<string>;
  writeText: (file: string, body: string) => Promise<void>;
  judge: (input: EvaluationJudgeInput) => Promise<EvaluationJudgeResult>;
}

const usage =
  "Usage: npm run evaluate:erb-conflicts -- --runtime <frozen-runtime.json> --labels <questions.jsonl> --output <report.json> --answers <answers.jsonl>";

export function parseEvaluateErbConflictArgs(args: string[]): EvaluateErbConflictArgs {
  const allowed = new Set(["--runtime", "--labels", "--output", "--answers"]);
  const values = new Map<string, string>();
  if (args.length !== 8) throw new TypeError(usage);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !allowed.has(flag) || !value || values.has(flag)) {
      throw new TypeError(usage);
    }
    values.set(flag, value);
  }
  const runtime = values.get("--runtime");
  const labels = values.get("--labels");
  const output = values.get("--output");
  const answers = values.get("--answers");
  if (!runtime || !labels || !output || !answers) throw new TypeError(usage);
  return { runtime, labels, output, answers };
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseErbConflictLabels(
  body: string,
  runtime: FrozenConflictRuntime,
): ErbConflictLabel[] {
  const wanted = new Set(runtime.cases.map((item) => item.questionId));
  const labels: ErbConflictLabel[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new TypeError("ERB labels file contains invalid JSONL");
    }
    if (!isRecord(value) || !wanted.has(String(value.question_id))) continue;
    if (
      value.question_type !== "conflicting_info" ||
      typeof value.question_id !== "string" ||
      typeof value.question !== "string" ||
      !Array.isArray(value.expected_doc_ids) ||
      value.expected_doc_ids.length === 0 ||
      !value.expected_doc_ids.every((id) => typeof id === "string" && id.length > 0) ||
      typeof value.gold_answer !== "string" ||
      value.gold_answer.length === 0 ||
      !Array.isArray(value.answer_facts) ||
      value.answer_facts.length === 0 ||
      !value.answer_facts.every((fact) => typeof fact === "string" && fact.length > 0)
    ) {
      throw new TypeError(`ERB conflict label has an invalid shape: ${String(value.question_id)}`);
    }
    labels.push({
      questionId: value.question_id,
      question: value.question,
      expectedDocumentIds: [...new Set(value.expected_doc_ids as string[])].sort(),
      goldAnswer: value.gold_answer,
      answerFacts: [...(value.answer_facts as string[])],
    });
  }
  return labels.sort((left, right) => left.questionId.localeCompare(right.questionId));
}

async function writeArtifact(
  writeText: EvaluationDependencies["writeText"],
  file: string,
  body: string,
) {
  await writeText(file, body);
}

export async function runErbConflictEvaluation(
  options: EvaluateErbConflictArgs,
  dependencies: EvaluationDependencies,
) {
  // This ordering is a correctness boundary: labels are not opened until the
  // label-free runtime has passed its recursive leakage and digest checks.
  const runtimeBody = await dependencies.readText(options.runtime);
  let runtime: FrozenConflictRuntime;
  try {
    runtime = parseFrozenConflictRuntime(JSON.parse(runtimeBody) as unknown);
  } catch (error) {
    throw new TypeError(
      `Frozen runtime validation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const runtimeDigest = sha256(runtimeBody);
  const labelsBody = await dependencies.readText(options.labels);
  const labelsDigest = sha256(labelsBody);
  const labels = parseErbConflictLabels(labelsBody, runtime);
  const labelById = new Map(labels.map((item) => [item.questionId, item]));
  const judgments: ErbJudgeOutcome[] = [];

  for (const runtimeCase of runtime.cases) {
    if (runtimeCase.status !== "completed" || runtimeCase.answer === null) continue;
    const label = labelById.get(runtimeCase.questionId);
    if (!label) continue;
    const started = performance.now();
    try {
      const result = await dependencies.judge({
        questionId: runtimeCase.questionId,
        question: runtimeCase.question,
        goldAnswer: label.goldAnswer,
        answerFacts: label.answerFacts,
        candidateAnswer: runtimeCase.answer,
      });
      judgments.push({
        questionId: runtimeCase.questionId,
        status: "scored",
        decision: result.decision,
        rawOutput: result.rawOutput,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      judgments.push(
        error instanceof EvaluationJudgeMalformedOutputError
          ? {
              questionId: runtimeCase.questionId,
              status: "unscored",
              kind: "malformed_output",
              rawOutput: error.rawOutput,
              latencyMs: error.latencyMs,
              error: error.message,
            }
          : {
              questionId: runtimeCase.questionId,
              status: "unscored",
              kind: "judge_error",
              rawOutput: null,
              latencyMs: Number((performance.now() - started).toFixed(3)),
              error: error instanceof Error ? error.message : String(error),
            },
      );
    }
  }

  const score = scoreErbConflictRuntime({ runtime, labels, judgments });
  const report = {
    schemaVersion: 1,
    evaluation: {
      promptVersion: ERB_ANSWER_EVALUATION_PROMPT_VERSION,
      model: QVAC_MODEL_ALIAS,
      labelsLoadedAfterRuntimeFreeze: true,
      runtimeFileSha256: runtimeDigest,
      labelsFileSha256: labelsDigest,
      frozenRuntimeDigest: runtime.digest,
    },
    ...score,
  };
  const answersBody = `${runtime.cases
    .map((item) =>
      JSON.stringify({
        question_id: item.questionId,
        answer:
          item.answer ??
          "Unable to answer from the accepted grounded evidence.",
        document_ids: item.evidenceDocumentIds,
      }),
    )
    .join("\n")}\n`;
  await writeArtifact(dependencies.writeText, options.output, `${JSON.stringify(report, null, 2)}\n`);
  await writeArtifact(dependencies.writeText, options.answers, answersBody);
  return report;
}

async function main(): Promise<void> {
  const options = parseEvaluateErbConflictArgs(process.argv.slice(2));
  const resolved = {
    runtime: path.resolve(options.runtime),
    labels: path.resolve(options.labels),
    output: path.resolve(options.output),
    answers: path.resolve(options.answers),
  };
  const judge = new QvacEvaluationJudge();
  const writeTextWithParents = async (file: string, body: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  };
  const report = await runErbConflictEvaluation(resolved, {
    readText: (file) => readFile(file, "utf8"),
    writeText: writeTextWithParents,
    judge: (input) => judge.evaluate(input),
  });
  console.log(JSON.stringify(report.aggregate, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
