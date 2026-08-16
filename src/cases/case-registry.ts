import runtimeManifestJson from "../../evaluation/judge-cases.runtime.json";

import { parseRuntimeManifestV2, type EvaluationCategory } from "@/evaluation/contract";

export type JudgeCaseKind =
  | "conflict"
  | "alignment"
  | "identity"
  | "knowledge_boundary"
  | "simple_lookup"
  | "multi_hop";

export type JudgeCaseBehavior =
  | "simple_lookup"
  | "multi_hop"
  | "resolved_conflict"
  | "unresolved_conflict"
  | "superseded"
  | "identity_accept"
  | "identity_reject"
  | "alignment_accept"
  | "alignment_reject"
  | "not_found"
  | "unknown";

export interface JudgeCase {
  id: string;
  kind: JudgeCaseKind;
  behavior: JudgeCaseBehavior;
  title: string;
  question: string;
  summary: string;
  dataset: string;
  version: string;
}

const behaviors = new Set<JudgeCaseBehavior>([
  "simple_lookup",
  "multi_hop",
  "resolved_conflict",
  "unresolved_conflict",
  "superseded",
  "identity_accept",
  "identity_reject",
  "alignment_accept",
  "alignment_reject",
  "not_found",
  "unknown",
]);

const kindByCategory: Record<EvaluationCategory, JudgeCaseKind> = {
  simple_lookup: "simple_lookup",
  multi_hop: "multi_hop",
  conflict: "conflict",
  supersession: "conflict",
  entity_resolution: "identity",
  ontology_alignment: "alignment",
  knowledge_boundary: "knowledge_boundary",
};

function presentationField(
  execution: Record<string, unknown>,
  field: "title" | "summary" | "dataset" | "version",
  caseId: string,
): string {
  const value = execution[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Runtime case ${caseId} is missing presentation field ${field}`);
  }
  return value;
}

function caseBehavior(execution: Record<string, unknown>, caseId: string): JudgeCaseBehavior {
  const behavior = execution.behavior;
  if (typeof behavior !== "string" || !behaviors.has(behavior as JudgeCaseBehavior)) {
    throw new Error(`Runtime case ${caseId} has an invalid behavior`);
  }
  return behavior as JudgeCaseBehavior;
}

const runtimeManifest = parseRuntimeManifestV2(runtimeManifestJson);
const cases: JudgeCase[] = runtimeManifest.cases.map((item) => ({
  id: item.id,
  kind: kindByCategory[item.category],
  behavior: caseBehavior(item.execution, item.id),
  title: presentationField(item.execution, "title", item.id),
  question: item.question,
  summary: presentationField(item.execution, "summary", item.id),
  dataset: presentationField(item.execution, "dataset", item.id),
  version: presentationField(item.execution, "version", item.id),
}));

export function listJudgeCases(): JudgeCase[] {
  return cases.map((item) => ({ ...item }));
}

export function getJudgeCase(caseId: string): JudgeCase | undefined {
  return listJudgeCases().find((item) => item.id === caseId);
}
