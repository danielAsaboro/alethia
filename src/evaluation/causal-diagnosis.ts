import { CAUSAL_ARM_IDS, type CausalArmId, type CausalCaseInput } from "./causal-arms";

export type CausalLossCategory =
  | "retrieval"
  | "identity"
  | "alignment"
  | "conflict-policy"
  | "context-budget"
  | "model-timeout"
  | "scorer-failure";

export interface LabelFreeCausalResultRow {
  caseId: string;
  armId: CausalArmId;
  status: "completed" | "rejected" | "failed";
  response: { answer: string; verdict: string; evidenceDocumentIds: string[] } | null;
  responseText: string;
  rawError: string | null;
  contextDocumentIds: string[];
  removedDocumentIds: string[];
  replacementDocumentIds: string[];
  contextTokenBudget: number;
  budgetPaddingTokens: number;
}

interface LabelFreeRuntime {
  labelFree: true;
  cases: CausalCaseInput[];
}

const forbiddenFields = new Set([
  "expected_doc_ids",
  "gold_answer",
  "answer_facts",
  "question_type",
  "expectedVerdict",
  "selectedAnswer",
  "evaluation_labels",
]);

function assertLabelFree(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLabelFree(item, [...path, String(index)]));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFields.has(key)) {
      throw new TypeError(`Forbidden evaluation field at ${[...path, key].join(".")}`);
    }
    assertLabelFree(child, [...path, key]);
  }
}

function responseSignature(row: LabelFreeCausalResultRow): string {
  return JSON.stringify({ status: row.status, response: row.response, rawError: row.rawError });
}

export function diagnoseCausalRun(input: {
  runtime: LabelFreeRuntime;
  results: LabelFreeCausalResultRow[];
}) {
  assertLabelFree(input.runtime);
  if (input.runtime.labelFree !== true || input.runtime.cases.length === 0) {
    throw new TypeError("Causal diagnosis requires a non-empty label-free runtime");
  }
  const traces = input.runtime.cases.map((causalCase) => {
    const rows = input.results.filter((row) => row.caseId === causalCase.caseId);
    const armIds = rows.map((row) => row.armId);
    if (
      rows.length !== CAUSAL_ARM_IDS.length ||
      new Set(armIds).size !== CAUSAL_ARM_IDS.length ||
      CAUSAL_ARM_IDS.some((armId) => !armIds.includes(armId))
    ) {
      throw new TypeError(`Causal diagnosis requires complete 10-arm accounting for ${causalCase.caseId}`);
    }
    const byArm = new Map(rows.map((row) => [row.armId, row]));
    const full = byArm.get("full_sourcetruce_grounding")!;
    const categories = new Set<CausalLossCategory>();
    const observations: string[] = [];
    const retrieval = new Set(causalCase.retrievalDocumentIds);
    const missingConflictRecords = causalCase.graph.conflictDocumentIds.filter((id) => !retrieval.has(id));
    if (missingConflictRecords.length > 0) {
      categories.add("retrieval");
      observations.push(`retrieval omitted ${missingConflictRecords.length} graph conflict record(s)`);
    }
    if (full.removedDocumentIds.length > 0) {
      categories.add("conflict-policy");
      const removed = new Set(full.removedDocumentIds);
      if (causalCase.retrievalDocumentIds.every((id) => removed.has(id))) {
        observations.push("full policy removed every retrieved source record");
      } else {
        observations.push(`full policy removed ${full.removedDocumentIds.length} retrieved source record(s)`);
      }
    }
    const noConflict = byArm.get("no_conflict_policy")!;
    if (responseSignature(full) !== responseSignature(noConflict)) {
      categories.add("conflict-policy");
      observations.push("full and no-conflict-policy runtime outputs diverged");
    }
    const noIdentity = byArm.get("no_identity_resolution")!;
    if (responseSignature(full) !== responseSignature(noIdentity)) {
      categories.add("identity");
      observations.push("full and no-identity-resolution runtime outputs diverged");
    }
    const noAlignment = byArm.get("no_ontology_alignment")!;
    if (responseSignature(full) !== responseSignature(noAlignment)) {
      categories.add("alignment");
      observations.push("full and no-ontology-alignment runtime outputs diverged");
    }
    if (new Set(rows.map((row) => row.contextTokenBudget)).size !== 1) {
      categories.add("context-budget");
      observations.push("arms received unequal source context token budgets");
    }
    const timeoutArms = rows.filter((row) => /timeout|timed out|aborted/i.test(row.rawError ?? ""));
    if (timeoutArms.length > 0) {
      categories.add("model-timeout");
      observations.push(`${timeoutArms.length} arm(s) ended in model timeout`);
    }
    const rejectedArms = rows.filter((row) => row.status === "rejected");
    if (rejectedArms.length > 0) {
      categories.add("scorer-failure");
      observations.push(`${rejectedArms.length} arm response(s) failed strict output validation`);
    }
    return {
      caseId: causalCase.caseId,
      categories: [...categories].sort(),
      observations,
      retrievalDocumentIds: [...causalCase.retrievalDocumentIds],
      graph: causalCase.graph,
      arms: rows.map((row) => ({
        armId: row.armId,
        status: row.status,
        response: row.response,
        rawError: row.rawError,
        contextDocumentIds: row.contextDocumentIds,
        removedDocumentIds: row.removedDocumentIds,
        replacementDocumentIds: row.replacementDocumentIds,
        contextTokenBudget: row.contextTokenBudget,
        budgetPaddingTokens: row.budgetPaddingTokens,
      })),
    };
  });
  const categories = Object.fromEntries(([
    "retrieval",
    "identity",
    "alignment",
    "conflict-policy",
    "context-budget",
    "model-timeout",
    "scorer-failure",
  ] satisfies CausalLossCategory[]).map((category) => [category, traces.filter((row) => row.categories.includes(category)).length]));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    labelsOpened: false as const,
    summary: { cases: traces.length, armsPerCase: CAUSAL_ARM_IDS.length, categories },
    cases: traces,
  };
}
