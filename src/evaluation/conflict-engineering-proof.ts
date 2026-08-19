import type { Claim } from "@/domain/ontology";
import { classifyClaimPair } from "@/conflicts/classify-conflicts";

const forbiddenDiscoveryKey = /^(?:question(?:id)?|question_id|expected_doc_ids|gold(?:_answer|answer|documentids?)|answer_facts|evaluation_labels)$/i;

export interface SourceOnlyConflict {
  kind: "contradiction" | "supersession";
  leftClaimId: string;
  rightClaimId: string;
  winningClaimId?: string;
  losingClaimId?: string;
}

export interface SourceOnlyDiscovery {
  claimsInspected: number;
  groupsInspected: number;
  crossSourcePairsInspected: number;
  conflicts: SourceOnlyConflict[];
}

function assertNoInventoryFields(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInventoryFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenDiscoveryKey.test(key)) throw new TypeError(`Source-only conflict discovery forbids ${key} at ${path}`);
    assertNoInventoryFields(nested, `${path}.${key}`);
  }
}

export function discoverSourceOnlyConflicts(claims: Claim[]): SourceOnlyDiscovery {
  assertNoInventoryFields(claims);
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    const key = `${claim.subjectEntityId}\0${claim.predicate}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }

  let crossSourcePairsInspected = 0;
  const conflicts: SourceOnlyConflict[] = [];
  for (const [, unsorted] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const group = [...unsorted].sort((left, right) => left.id.localeCompare(right.id));
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex]!, right = group[rightIndex]!;
        if (left.sourceObjectId === right.sourceObjectId || left.sourceSystem === right.sourceSystem) continue;
        crossSourcePairsInspected += 1;
        const classification = classifyClaimPair(left, right);
        if (classification.kind === "contradiction") {
          conflicts.push({ kind: "contradiction", leftClaimId: left.id, rightClaimId: right.id });
        } else if (classification.kind === "supersession") {
          conflicts.push({
            kind: "supersession",
            leftClaimId: left.id,
            rightClaimId: right.id,
            winningClaimId: classification.winningClaimId,
            losingClaimId: classification.losingClaimId,
          });
        }
      }
    }
  }
  return { claimsInspected: claims.length, groupsInspected: groups.size, crossSourcePairsInspected, conflicts };
}

interface ArmMetrics {
  answerCorrectness: number;
  currentValueSurfaced: number;
  unsupportedAnswerRate: number;
  retiredValuePresentedAsCurrent: number;
  [key: string]: number | null;
}

interface RuntimeRow {
  caseId: string;
  armId: string;
  contextDocumentIds: string[];
  removedDocumentIds: string[];
  replacementDocumentIds: string[];
  hydraQueryCount: number;
}

interface TopKSummary {
  topK: number;
  totalQuestions: number;
  conflictMatches: number;
  interventions: number;
  unsupportedInterventions: number;
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

export function buildConflictEngineeringProof(input: {
  sourceOnlyDiscovery: SourceOnlyDiscovery;
  scoredArms: Record<string, ArmMetrics>;
  runtimeRows: RuntimeRow[];
  topKSummaries: TopKSummary[];
  batching: { maximumRoundTripsPerRequest: number; allQueryIdsUnique: boolean; noLinearPerDocumentQueryGrowth: boolean };
}) {
  const orderedArmIds = [
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
  ];
  const conflictOnlyHeadline = orderedArmIds
    .filter((armId) => input.scoredArms[armId] !== undefined)
    .map((armId) => ({ armId, ...input.scoredArms[armId]! }));
  const cut = input.scoredArms.superseded_evidence_removal;
  const pin = input.scoredArms.current_evidence_pinning;
  const full = input.scoredArms.full_alethia_grounding;
  if (!cut || !pin || !full) throw new TypeError("Cut-versus-pin proof requires cut, pin, and full arms");

  const cases = new Set(input.runtimeRows.map((row) => row.caseId));
  return {
    schemaVersion: 1,
    scope: "Conflict-only labeled development results; not unseen generalization evidence.",
    inventoryFreeMechanism: {
      questionIdsRead: false,
      goldDocumentIdsRead: false,
      goldAnswersRead: false,
      groupingKeys: ["subjectEntityId", "predicate"],
      discovery: input.sourceOnlyDiscovery,
      qualification: "The discovery function accepts normalized source claims only. Any benchmark slice used to evaluate outcomes retains its separate acquisition provenance and is not relabeled as corpus-wide unseen discovery.",
    },
    conflictOnlyHeadline,
    cutVersusPin: {
      cut: { answerCorrectness: cut.answerCorrectness, currentValueSurfaced: cut.currentValueSurfaced },
      pin: { answerCorrectness: pin.answerCorrectness, currentValueSurfaced: pin.currentValueSurfaced },
      full: { answerCorrectness: full.answerCorrectness, currentValueSurfaced: full.currentValueSurfaced },
      fullMinusCutCorrectness: round(full.answerCorrectness - cut.answerCorrectness),
      fullMinusPinCorrectness: round(full.answerCorrectness - pin.answerCorrectness),
    },
    retrievalTopology: {
      cases: cases.size,
      rows: input.runtimeRows.length,
      unchangedRows: input.runtimeRows.filter((row) => row.removedDocumentIds.length === 0).length,
      cutRows: input.runtimeRows.filter((row) => row.removedDocumentIds.length > 0).length,
      replacementRows: input.runtimeRows.filter((row) => row.replacementDocumentIds.length > 0).length,
      hydraQueries: input.runtimeRows.reduce((sum, row) => sum + row.hydraQueryCount, 0),
    },
    topKSensitivity: [...input.topKSummaries].sort((left, right) => left.topK - right.topK),
    hydraBatching: {
      ...input.batching,
      proves: "Bounded client round trips and no linear per-document query growth for the measured query shape.",
      doesNotProve: "Competitive latency or a universal speed advantage; measured latency is environment-specific.",
    },
  };
}
