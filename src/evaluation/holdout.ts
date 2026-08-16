import { createHash } from "node:crypto";

import {
  parseEvaluationLabelsV2,
  parseRuntimeManifestV2,
  type EvaluationAttemptV2,
  type EvaluationLabelsV2,
  type EvaluationRuntimeManifestV2,
} from "./contract";
import { scoreAttemptsV2, type EvaluationReportV2 } from "./metrics";

interface HoldoutModelIdentity {
  alias: string;
  sha256: string;
  contextSize: number;
}

export interface HoldoutDesign {
  state?: "designed";
  runtime: EvaluationRuntimeManifestV2;
  publicCommit: string;
  acquisitionDigest: string;
  extractionPromptVersion: string;
  retrievalConfigDigest: string;
  policyVersions: string[];
  model: HoldoutModelIdentity;
}

export interface FrozenHoldout extends Omit<HoldoutDesign, "state"> {
  schemaVersion: 1;
  state: "frozen";
  frozenAt: string;
  runtimeDigest: string;
  freezeDigest: string;
}

export interface ExecutedHoldout extends Omit<FrozenHoldout, "state"> {
  state: "executed";
  executedAt: string;
  attempts: EvaluationAttemptV2[];
  attemptsDigest: string;
  executionEvidence: unknown;
  executionEvidenceDigest: string;
  executionDigest: string;
}

export interface ScoredHoldout extends Omit<ExecutedHoldout, "state"> {
  state: "scored";
  scoredAt: string;
  labelsDigest: string;
  report: EvaluationReportV2;
  scoreDigest: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((item) => [item, canonical(value[item])]));
}

export function holdoutDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function assertHex(value: string, length: number, label: string): void {
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value)) throw new TypeError(`${label} must be ${length} hexadecimal characters`);
}

function frozenCore(value: FrozenHoldout): Omit<FrozenHoldout, "freezeDigest"> {
  const core = { ...value } as Partial<FrozenHoldout>;
  delete core.freezeDigest;
  return core as Omit<FrozenHoldout, "freezeDigest">;
}

export function assertFrozenHoldout(value: FrozenHoldout): void {
  if (value.state !== "frozen") throw new TypeError("Holdout must be frozen before execution");
  if (holdoutDigest(frozenCore(value)) !== value.freezeDigest) throw new TypeError("Holdout freeze digest mismatch");
  if (holdoutDigest(value.runtime) !== value.runtimeDigest) throw new TypeError("Holdout runtime digest mismatch");
  parseRuntimeManifestV2(value.runtime);
}

export function freezeHoldout(design: HoldoutDesign): FrozenHoldout {
  const runtime = parseRuntimeManifestV2(design.runtime);
  assertHex(design.publicCommit, 40, "publicCommit");
  assertHex(design.acquisitionDigest, 64, "acquisitionDigest");
  assertHex(design.retrievalConfigDigest, 64, "retrievalConfigDigest");
  assertHex(design.model.sha256, 64, "model.sha256");
  if (!design.extractionPromptVersion || !design.model.alias || !Number.isSafeInteger(design.model.contextSize) || design.model.contextSize < 1) {
    throw new TypeError("Holdout design has invalid extraction or model configuration");
  }
  const core: Omit<FrozenHoldout, "freezeDigest"> = {
    schemaVersion: 1,
    state: "frozen",
    frozenAt: new Date().toISOString(),
    runtime,
    publicCommit: design.publicCommit,
    acquisitionDigest: design.acquisitionDigest,
    extractionPromptVersion: design.extractionPromptVersion,
    retrievalConfigDigest: design.retrievalConfigDigest,
    policyVersions: [...design.policyVersions].sort(),
    model: structuredClone(design.model),
    runtimeDigest: holdoutDigest(runtime),
  };
  return { ...core, freezeDigest: holdoutDigest(core) };
}

function assertAttempts(runtime: EvaluationRuntimeManifestV2, attempts: EvaluationAttemptV2[]): void {
  const runtimeIds = [...runtime.cases.map((item) => item.id)].sort();
  const attemptIds = [...attempts.map((item) => item.caseId)].sort();
  if (new Set(attemptIds).size !== attemptIds.length || JSON.stringify(runtimeIds) !== JSON.stringify(attemptIds)) {
    throw new TypeError("Execution must preserve exactly one attempt for every frozen runtime case");
  }
}

export function runFrozenHoldout(frozen: FrozenHoldout, attempts: EvaluationAttemptV2[], executionEvidence: unknown = null): ExecutedHoldout {
  assertFrozenHoldout(frozen);
  assertAttempts(frozen.runtime, attempts);
  const attemptsCopy = structuredClone(attempts);
  const attemptsDigest = holdoutDigest(attemptsCopy);
  const evidenceCopy = structuredClone(executionEvidence);
  const executionEvidenceDigest = holdoutDigest(evidenceCopy);
  const executedAt = new Date().toISOString();
  const executionDigest = holdoutDigest({ freezeDigest: frozen.freezeDigest, attemptsDigest, executionEvidenceDigest, executedAt });
  return { ...frozen, state: "executed", executedAt, attempts: attemptsCopy, attemptsDigest, executionEvidence: evidenceCopy, executionEvidenceDigest, executionDigest };
}

function assertExecuted(value: ExecutedHoldout): void {
  if (value.state !== "executed") throw new TypeError("Holdout must be executed before scoring");
  const { executedAt, attempts, attemptsDigest, executionEvidence, executionEvidenceDigest, executionDigest, ...frozenFields } = value;
  assertFrozenHoldout({ ...frozenFields, state: "frozen" });
  assertAttempts(value.runtime, attempts);
  if (holdoutDigest(attempts) !== attemptsDigest) throw new TypeError("Holdout attempt digest mismatch");
  if (holdoutDigest(executionEvidence) !== executionEvidenceDigest) throw new TypeError("Holdout execution evidence digest mismatch");
  if (holdoutDigest({ freezeDigest: value.freezeDigest, attemptsDigest, executionEvidenceDigest, executedAt }) !== executionDigest) throw new TypeError("Holdout execution digest mismatch");
}

export function scoreFrozenHoldout(
  executed: ExecutedHoldout | FrozenHoldout | HoldoutDesign,
  labelsInput: EvaluationLabelsV2,
): ScoredHoldout {
  if (executed.state !== "executed") throw new TypeError("Holdout must be executed before scoring");
  assertExecuted(executed);
  const labels = parseEvaluationLabelsV2(labelsInput);
  const runtimeIds = [...executed.runtime.cases.map((item) => item.id)].sort();
  const labelIds = [...labels.labels.map((item) => item.caseId)].sort();
  if (JSON.stringify(runtimeIds) !== JSON.stringify(labelIds)) throw new TypeError("Holdout labels must match the frozen runtime cases exactly");
  const report = scoreAttemptsV2(executed.attempts, labels.labels);
  const labelsDigest = holdoutDigest(labels);
  const scoredAt = new Date().toISOString();
  const scoreDigest = holdoutDigest({ executionDigest: executed.executionDigest, labelsDigest, report, scoredAt });
  return { ...executed, state: "scored", scoredAt, labelsDigest, report, scoreDigest };
}
