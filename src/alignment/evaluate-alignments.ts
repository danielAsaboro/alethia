import type { AlignmentDecision } from "./alignment-policy";

export type AlignmentAuditStratum =
  | "contextual_mapping"
  | "same_surface_different_meaning"
  | "domain_range_hard_negative"
  | "different_surface_equivalent_meaning";

export interface AlignmentAuditLabel {
  sourceTermId: string;
  candidateOntologyTermId: string;
  expectedStatus: "accepted" | "rejected";
  stratum: AlignmentAuditStratum;
  rationale: string;
}

type Status = AlignmentAuditLabel["expectedStatus"];
type Confusion = Record<Status, Record<Status, number>>;

function key(value: Pick<AlignmentAuditLabel, "sourceTermId" | "candidateOntologyTermId">): string {
  return `${value.sourceTermId}\0${value.candidateOntologyTermId}`;
}

function emptyConfusion(): Confusion {
  return { accepted: { accepted: 0, rejected: 0 }, rejected: { accepted: 0, rejected: 0 } };
}

function score(rows: Array<{ expected: Status; actual: Status }>) {
  const confusion = emptyConfusion();
  let correct = 0;
  for (const row of rows) {
    confusion[row.expected][row.actual] += 1;
    if (row.expected === row.actual) correct += 1;
  }
  return { count: rows.length, correct, accuracy: rows.length === 0 ? null : correct / rows.length, confusion };
}

export function evaluateAlignmentDecisions(
  decisions: AlignmentDecision[],
  labels: AlignmentAuditLabel[],
) {
  const decisionsByKey = new Map<string, AlignmentDecision>();
  for (const decision of decisions) {
    const mappingKey = key(decision);
    if (decisionsByKey.has(mappingKey)) throw new TypeError(`Duplicate alignment decision: ${mappingKey}`);
    decisionsByKey.set(mappingKey, decision);
  }
  const seenLabels = new Set<string>();
  const matched = labels.map((label) => {
    const mappingKey = key(label);
    if (seenLabels.has(mappingKey)) throw new TypeError(`Duplicate alignment label: ${mappingKey}`);
    seenLabels.add(mappingKey);
    const decision = decisionsByKey.get(mappingKey);
    if (!decision) throw new TypeError(`Unmatched alignment label: ${mappingKey}`);
    if (decision.status === "pending") throw new TypeError(`Pending audited alignment decision: ${mappingKey}`);
    return { label, decision, expected: label.expectedStatus, actual: decision.status };
  });
  const rows = matched.map(({ expected, actual }) => ({ expected, actual }));
  const overall = score(rows);
  const statuses: Status[] = ["accepted", "rejected"];
  const strata: AlignmentAuditStratum[] = [
    "contextual_mapping",
    "same_surface_different_meaning",
    "domain_range_hard_negative",
    "different_surface_equivalent_meaning",
  ];
  return {
    auditedMappings: labels.length,
    decisionCounts: {
      accepted: decisions.filter((item) => item.status === "accepted").length,
      rejected: decisions.filter((item) => item.status === "rejected").length,
      pending: decisions.filter((item) => item.status === "pending").length,
    },
    expectedCounts: Object.fromEntries(statuses.map((status) => [status, labels.filter((item) => item.expectedStatus === status).length])),
    accuracy: overall.accuracy,
    confusion: overall.confusion,
    byExpectedStatus: Object.fromEntries(statuses.map((status) => [status, score(rows.filter((row) => row.expected === status))])),
    byStratum: Object.fromEntries(strata.map((stratum) => [stratum, score(matched.filter((row) => row.label.stratum === stratum).map(({ expected, actual }) => ({ expected, actual })))])),
    errors: matched.filter(({ expected, actual }) => expected !== actual).map(({ label, decision }) => ({
      sourceTermId: label.sourceTermId,
      candidateOntologyTermId: label.candidateOntologyTermId,
      expectedStatus: label.expectedStatus,
      actualStatus: decision.status,
      stratum: label.stratum,
      rationale: label.rationale,
      decisionId: decision.id,
    })),
  };
}

export function parseAlignmentAuditLabels(value: unknown): AlignmentAuditLabel[] {
  if (!value || typeof value !== "object") throw new TypeError("Alignment labels must be an object");
  const artifact = value as { schemaVersion?: unknown; labels?: unknown };
  if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.labels)) throw new TypeError("Unsupported alignment label artifact");
  return artifact.labels.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new TypeError(`Invalid alignment label at index ${index}`);
    const label = raw as Record<string, unknown>;
    const validStatus = label.expectedStatus === "accepted" || label.expectedStatus === "rejected";
    const validStratum = ["contextual_mapping", "same_surface_different_meaning", "domain_range_hard_negative", "different_surface_equivalent_meaning"].includes(String(label.stratum));
    if (typeof label.sourceTermId !== "string" || typeof label.candidateOntologyTermId !== "string" || !validStatus || !validStratum || typeof label.rationale !== "string") {
      throw new TypeError(`Invalid alignment label at index ${index}`);
    }
    return label as unknown as AlignmentAuditLabel;
  });
}
