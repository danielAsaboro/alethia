import { createHash } from "node:crypto";

export const CAUSAL_ARM_IDS = [
  "plain_retrieval",
  "random_matched_removal",
  "superseded_evidence_removal",
  "current_evidence_pinning",
  "full_alethia_grounding",
  "prompt_only_conflict_reconciliation",
  "no_hydra",
  "no_identity_resolution",
  "no_ontology_alignment",
  "no_conflict_policy",
] as const;

export type CausalArmId = typeof CAUSAL_ARM_IDS[number];

export interface CausalDocument {
  id: string;
  sourceSystem: string;
  text: string;
  tokenCount: number;
  lifecycle: "current" | "superseded" | "unknown";
}

export interface CausalCaseInput {
  caseId: string;
  question: string;
  documents: CausalDocument[];
  retrievalDocumentIds: string[];
  graph: {
    currentDocumentIds: string[];
    supersededDocumentIds: string[];
    conflictDocumentIds: string[];
    verdict: "SUPPORTED" | "DISPUTED" | "UNKNOWN" | "NOT_FOUND";
    hydraQueryIds: string[];
  };
}

export interface CausalArm {
  id: CausalArmId;
  caseId: string;
  question: string;
  documents: CausalDocument[];
  contextTokenCount: number;
  removedDocumentIds: string[];
  replacementDocumentIds: string[];
  hydraQueryIds: string[];
  promptMetadata: {
    reconcileConflicts: boolean;
    graphGrounded: boolean;
    identityResolution: boolean;
    ontologyAlignment: boolean;
    conflictPolicy: boolean;
    selectedAnswer?: never;
    expectedVerdict?: never;
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableIndex(seed: string, length: number): number {
  if (length < 1) throw new TypeError("Cannot select from an empty collection");
  return Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) % length;
}

function requireDocuments(input: CausalCaseInput): Map<string, CausalDocument> {
  const byId = new Map(input.documents.map((document) => [document.id, document]));
  if (byId.size !== input.documents.length) throw new TypeError("Causal documents require unique IDs");
  if (input.retrievalDocumentIds.length < 1) throw new TypeError("Causal cases require retrieved documents");
  for (const id of input.retrievalDocumentIds) {
    if (!byId.has(id)) throw new TypeError(`Retrieved document ${id} is unavailable`);
  }
  return byId;
}

function replaceRemoved(
  input: CausalCaseInput,
  byId: Map<string, CausalDocument>,
  removedIds: string[],
): { documents: CausalDocument[]; replacements: string[] } {
  const removed = new Set(removedIds);
  const retained = input.retrievalDocumentIds.filter((id) => !removed.has(id));
  const used = new Set(input.retrievalDocumentIds);
  const replacements: string[] = [];
  for (const removedId of removedIds) {
    const target = byId.get(removedId)!;
    const replacement = [...input.documents].reverse().find(
      (candidate) => !used.has(candidate.id) && candidate.tokenCount === target.tokenCount,
    );
    if (!replacement) {
      throw new Error(`No real matched-token distractor can replace ${removedId}`);
    }
    used.add(replacement.id);
    replacements.push(replacement.id);
  }
  const selected = [...retained, ...replacements].map((id) => byId.get(id)!);
  if (selected.length !== input.retrievalDocumentIds.length) throw new Error("Causal document-count parity failed");
  return { documents: selected, replacements };
}

function arm(
  input: CausalCaseInput,
  byId: Map<string, CausalDocument>,
  id: CausalArmId,
  removedDocumentIds: string[],
  promptMetadata: CausalArm["promptMetadata"],
): CausalArm {
  const removal = replaceRemoved(input, byId, removedDocumentIds);
  const baselineTokens = input.retrievalDocumentIds.reduce((total, documentId) => total + byId.get(documentId)!.tokenCount, 0);
  const contextTokenCount = removal.documents.reduce((total, document) => total + document.tokenCount, 0);
  if (contextTokenCount !== baselineTokens) throw new Error(`Causal token parity failed for ${id}`);
  return {
    id,
    caseId: input.caseId,
    question: input.question,
    documents: removal.documents,
    contextTokenCount,
    removedDocumentIds,
    replacementDocumentIds: removal.replacements,
    hydraQueryIds: promptMetadata.graphGrounded ? [...input.graph.hydraQueryIds] : [],
    promptMetadata,
  };
}

export function buildCausalArms(input: CausalCaseInput, seed: string): CausalArm[] {
  const byId = requireDocuments(input);
  const retrieval = input.retrievalDocumentIds;
  const randomRemoved = [retrieval[stableIndex(`${seed}:${input.caseId}`, retrieval.length)]!];
  const superseded = unique(input.graph.supersededDocumentIds.filter((id) => retrieval.includes(id)));
  const nonCurrent = retrieval.filter((id) => !input.graph.currentDocumentIds.includes(id));
  const fullGroundingRemoved = superseded;
  const metadata = (
    graphGrounded: boolean,
    reconcileConflicts = false,
    identityResolution = true,
    ontologyAlignment = true,
    conflictPolicy = true,
  ): CausalArm["promptMetadata"] => ({ reconcileConflicts, graphGrounded, identityResolution, ontologyAlignment, conflictPolicy });

  return [
    arm(input, byId, "plain_retrieval", [], metadata(false)),
    arm(input, byId, "random_matched_removal", randomRemoved, metadata(false)),
    arm(input, byId, "superseded_evidence_removal", superseded, metadata(true)),
    arm(input, byId, "current_evidence_pinning", nonCurrent, metadata(true)),
    arm(input, byId, "full_alethia_grounding", fullGroundingRemoved, metadata(true, true)),
    arm(input, byId, "prompt_only_conflict_reconciliation", [], metadata(false, true)),
    arm(input, byId, "no_hydra", [], metadata(false)),
    arm(input, byId, "no_identity_resolution", fullGroundingRemoved, metadata(true, true, false)),
    arm(input, byId, "no_ontology_alignment", fullGroundingRemoved, metadata(true, true, true, false)),
    arm(input, byId, "no_conflict_policy", [], metadata(true, false, true, true, false)),
  ];
}
