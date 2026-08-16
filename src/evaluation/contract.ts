import type { Verdict } from "@/domain/ontology";

export type EvaluationCategory =
  | "simple_lookup"
  | "multi_hop"
  | "conflict"
  | "supersession"
  | "entity_resolution"
  | "ontology_alignment"
  | "knowledge_boundary";

export type EvaluationFact =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; unit?: string }
  | { kind: "percentage"; value: number }
  | { kind: "duration"; value: number; unit: "milliseconds" | "seconds" | "minutes" | "hours" }
  | { kind: "identifier_set"; values: string[] }
  | { kind: "entity_set"; values: string[] }
  | { kind: "relationship_path"; relationships: string[] };

export type CoverageEvaluationState =
  | "complete"
  | "partial"
  | "failed"
  | "missing"
  | "not_applicable";

export type ConflictEvaluationState =
  | "none"
  | "detected"
  | "resolved"
  | "unresolved"
  | "not_applicable";

export type DecisionEvaluationState =
  | "accepted"
  | "rejected"
  | "pending"
  | "not_applicable";

export interface EvaluationRuntimeCaseV2 {
  id: string;
  question: string;
  category: EvaluationCategory;
  execution: Record<string, unknown>;
}

export interface EvaluationRuntimeManifestV2 {
  schemaVersion: 2;
  cases: EvaluationRuntimeCaseV2[];
}

export interface RequiredGraphProofV2 {
  sourceLabel?: string;
  targetLabel?: string;
  requiredRelationships: string[];
  minimumPathLength?: number;
  maximumPathLength?: number;
  requireLiveQueryId: boolean;
}

export interface EvaluationLabelV2 {
  caseId: string;
  expectedVerdict: Verdict;
  expectedFacts: EvaluationFact[];
  expectedEvidenceDocumentIds: string[];
  expectedRelationships: string[];
  forbiddenRelationships: string[];
  requiredCoverageState: CoverageEvaluationState;
  expectedConflictState: ConflictEvaluationState;
  requiredGraphProof: RequiredGraphProofV2;
  expectedIdentityState: DecisionEvaluationState;
  expectedAlignmentState: DecisionEvaluationState;
}

export interface EvaluationLabelsV2 {
  schemaVersion: 2;
  labels: EvaluationLabelV2[];
}

export interface EvaluationGraphProofV2 {
  queryId: string | null;
  live: boolean;
  relationshipTypes: string[];
  pathLength: number;
  sourceLabel?: string;
  targetLabel?: string;
}

interface BaseAttemptV2 {
  schemaVersion: 2;
  caseId: string;
  latencyMs: number;
}

export interface CompletedEvaluationAttemptV2 extends BaseAttemptV2 {
  status: "completed";
  verdict: Verdict;
  facts: EvaluationFact[];
  evidenceDocumentIds: string[];
  relationships: string[];
  coverageState: CoverageEvaluationState;
  conflictState: ConflictEvaluationState;
  identityState?: DecisionEvaluationState;
  alignmentState?: DecisionEvaluationState;
  grounding: { accepted: number; rejected: number };
  graphProofs: EvaluationGraphProofV2[];
}

export interface RejectedEvaluationAttemptV2 extends BaseAttemptV2 {
  status: "rejected";
  reason: string;
}

export interface FailedEvaluationAttemptV2 extends BaseAttemptV2 {
  status: "failed";
  error: string;
}

export type EvaluationAttemptV2 =
  | CompletedEvaluationAttemptV2
  | RejectedEvaluationAttemptV2
  | FailedEvaluationAttemptV2;

const forbiddenRuntimeKey = /(?:^|_)(?:expected|gold|answer[_-]?facts?|evaluation[_-]?labels?)(?:$|_)/i;
const forbiddenCollapsedKey = /^(?:expected|gold|answerfacts?|evaluationlabels?)/i;

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNoRuntimeLabels(value: unknown, path = "runtime"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRuntimeLabels(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const collapsed = key.replace(/[^a-z0-9]/gi, "");
    if (forbiddenRuntimeKey.test(key) || forbiddenCollapsedKey.test(collapsed)) {
      throw new Error(`Forbidden evaluation label key at ${path}.${key}`);
    }
    assertNoRuntimeLabels(nested, `${path}.${key}`);
  }
}

const categories = new Set<EvaluationCategory>([
  "simple_lookup",
  "multi_hop",
  "conflict",
  "supersession",
  "entity_resolution",
  "ontology_alignment",
  "knowledge_boundary",
]);

export function parseRuntimeManifestV2(value: unknown): EvaluationRuntimeManifestV2 {
  assertNoRuntimeLabels(value);
  assertObject(value, "runtime manifest");
  if (value.schemaVersion !== 2 || !Array.isArray(value.cases)) {
    throw new Error("Runtime manifest must use schemaVersion 2 and contain cases");
  }

  const cases = value.cases.map((item, index) => {
    assertObject(item, `cases[${index}]`);
    if (
      typeof item.id !== "string" ||
      typeof item.question !== "string" ||
      typeof item.category !== "string" ||
      !categories.has(item.category as EvaluationCategory)
    ) {
      throw new Error(`cases[${index}] has an invalid id, question, or category`);
    }
    assertObject(item.execution, `cases[${index}].execution`);
    return {
      id: item.id,
      question: item.question,
      category: item.category as EvaluationCategory,
      execution: structuredClone(item.execution),
    };
  });

  if (new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new Error("Runtime case IDs must be unique");
  }
  return { schemaVersion: 2, cases };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
  return [...value];
}

function parseGraphProof(value: unknown, label: string): RequiredGraphProofV2 {
  assertObject(value, label);
  if (typeof value.requireLiveQueryId !== "boolean") {
    throw new Error(`${label}.requireLiveQueryId must be boolean`);
  }
  for (const key of ["minimumPathLength", "maximumPathLength"] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 0)) {
      throw new Error(`${label}.${key} must be a non-negative integer`);
    }
  }
  return {
    ...(typeof value.sourceLabel === "string" ? { sourceLabel: value.sourceLabel } : {}),
    ...(typeof value.targetLabel === "string" ? { targetLabel: value.targetLabel } : {}),
    requiredRelationships: stringArray(value.requiredRelationships, `${label}.requiredRelationships`),
    ...(value.minimumPathLength === undefined ? {} : { minimumPathLength: Number(value.minimumPathLength) }),
    ...(value.maximumPathLength === undefined ? {} : { maximumPathLength: Number(value.maximumPathLength) }),
    requireLiveQueryId: value.requireLiveQueryId,
  };
}

export function parseEvaluationLabelsV2(value: unknown): EvaluationLabelsV2 {
  assertObject(value, "evaluation labels");
  if (value.schemaVersion !== 2 || !Array.isArray(value.labels)) {
    throw new Error("Evaluation labels must use schemaVersion 2 and contain labels");
  }

  const verdicts = new Set<Verdict>(["SUPPORTED", "DISPUTED", "NOT_FOUND", "UNKNOWN"]);
  const coverageStates = new Set<CoverageEvaluationState>(["complete", "partial", "failed", "missing", "not_applicable"]);
  const conflictStates = new Set<ConflictEvaluationState>(["none", "detected", "resolved", "unresolved", "not_applicable"]);
  const decisionStates = new Set<DecisionEvaluationState>(["accepted", "rejected", "pending", "not_applicable"]);

  const labels = value.labels.map((item, index) => {
    assertObject(item, `labels[${index}]`);
    if (typeof item.caseId !== "string" || !verdicts.has(item.expectedVerdict as Verdict)) {
      throw new Error(`labels[${index}] has an invalid caseId or verdict`);
    }
    if (!Array.isArray(item.expectedFacts)) throw new Error(`labels[${index}].expectedFacts must be an array`);
    if (!coverageStates.has(item.requiredCoverageState as CoverageEvaluationState)) throw new Error(`labels[${index}] has invalid coverage state`);
    if (!conflictStates.has(item.expectedConflictState as ConflictEvaluationState)) throw new Error(`labels[${index}] has invalid conflict state`);
    if (!decisionStates.has(item.expectedIdentityState as DecisionEvaluationState)) throw new Error(`labels[${index}] has invalid identity state`);
    if (!decisionStates.has(item.expectedAlignmentState as DecisionEvaluationState)) throw new Error(`labels[${index}] has invalid alignment state`);
    return {
      caseId: item.caseId,
      expectedVerdict: item.expectedVerdict as Verdict,
      expectedFacts: structuredClone(item.expectedFacts) as EvaluationFact[],
      expectedEvidenceDocumentIds: stringArray(item.expectedEvidenceDocumentIds, `labels[${index}].expectedEvidenceDocumentIds`),
      expectedRelationships: stringArray(item.expectedRelationships, `labels[${index}].expectedRelationships`),
      forbiddenRelationships: stringArray(item.forbiddenRelationships, `labels[${index}].forbiddenRelationships`),
      requiredCoverageState: item.requiredCoverageState as CoverageEvaluationState,
      expectedConflictState: item.expectedConflictState as ConflictEvaluationState,
      requiredGraphProof: parseGraphProof(item.requiredGraphProof, `labels[${index}].requiredGraphProof`),
      expectedIdentityState: item.expectedIdentityState as DecisionEvaluationState,
      expectedAlignmentState: item.expectedAlignmentState as DecisionEvaluationState,
    };
  });

  if (new Set(labels.map((item) => item.caseId)).size !== labels.length) {
    throw new Error("Evaluation label case IDs must be unique");
  }
  return { schemaVersion: 2, labels };
}
