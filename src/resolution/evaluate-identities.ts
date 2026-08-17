import type { ResolutionDecision } from "./resolve-entities";

export type IdentityAuditStratum =
  | "exact_identifier"
  | "alias_or_verified_link"
  | "name_similarity"
  | "conflicting_verified_identifiers"
  | "different_surface_same_person"
  | "same_name_different_company"
  | "same_name_different_role"
  | "ambiguous_alias"
  | "transitive_cluster"
  | "high_degree_identity"
  | "missing_identifier";

export interface IdentityPairLabel {
  leftSourceObjectId: string;
  rightSourceObjectId: string;
  sameEntity: boolean;
  stratum: IdentityAuditStratum;
  rationale: string;
  leftClusterId?: string;
  rightClusterId?: string;
}

interface PairwiseQuality {
  pairs: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
  falseMerges: number;
  falseSplits: number;
}

export function identityPairId(left: string, right: string): string {
  if (!left || !right || left === right) throw new TypeError("Identity audit pairs require two distinct source IDs");
  return [left, right].sort().join("\u0000");
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function quality(rows: Array<{ expected: boolean; predicted: boolean }>): PairwiseQuality {
  const truePositive = rows.filter((row) => row.expected && row.predicted).length;
  const falsePositive = rows.filter((row) => !row.expected && row.predicted).length;
  const falseNegative = rows.filter((row) => row.expected && !row.predicted).length;
  const trueNegative = rows.filter((row) => !row.expected && !row.predicted).length;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1 = precision === null || recall === null
    ? null
    : precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    pairs: rows.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1,
    accuracy: ratio(truePositive + trueNegative, rows.length),
    falseMerges: falsePositive,
    falseSplits: falseNegative,
  };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: string[]) { ids.forEach((id) => this.parent.set(id, id)); }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) throw new TypeError(`Unknown audited source object ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const roots = [this.find(left), this.find(right)].sort();
    if (roots[0] !== roots[1]) this.parent.set(roots[1]!, roots[0]!);
  }
}

function bCubed(
  labels: IdentityPairLabel[],
  decisions: Map<string, ResolutionDecision>,
): { precision: number; recall: number; f1: number; objects: number } | null {
  if (labels.some((label) => !label.leftClusterId || !label.rightClusterId)) return null;
  const truth = new Map<string, string>();
  for (const label of labels) {
    for (const [objectId, clusterId] of [
      [label.leftSourceObjectId, label.leftClusterId!],
      [label.rightSourceObjectId, label.rightClusterId!],
    ] as const) {
      const existing = truth.get(objectId);
      if (existing && existing !== clusterId) throw new TypeError(`Conflicting cluster labels for ${objectId}`);
      truth.set(objectId, clusterId);
    }
  }
  const objects = [...truth.keys()].sort();
  const predicted = new DisjointSet(objects);
  for (const [key, decision] of decisions) {
    if (decision.status !== "accepted") continue;
    const [left, right] = key.split("\u0000");
    if (left && right && truth.has(left) && truth.has(right)) predicted.union(left, right);
  }
  const predictedMembers = new Map<string, Set<string>>();
  const truthMembers = new Map<string, Set<string>>();
  for (const objectId of objects) {
    const predictedId = predicted.find(objectId);
    predictedMembers.set(predictedId, new Set([...(predictedMembers.get(predictedId) ?? []), objectId]));
    const truthId = truth.get(objectId)!;
    truthMembers.set(truthId, new Set([...(truthMembers.get(truthId) ?? []), objectId]));
  }
  let precision = 0;
  let recall = 0;
  for (const objectId of objects) {
    const predictedCluster = predictedMembers.get(predicted.find(objectId))!;
    const truthCluster = truthMembers.get(truth.get(objectId)!)!;
    const intersection = [...predictedCluster].filter((candidate) => truthCluster.has(candidate)).length;
    precision += intersection / predictedCluster.size;
    recall += intersection / truthCluster.size;
  }
  precision /= objects.length;
  recall /= objects.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, objects: objects.length };
}

function clusterPurity(
  labels: IdentityPairLabel[],
  decisions: Map<string, ResolutionDecision>,
): { purity: number; clusters: number; objects: number } | null {
  if (labels.some((label) => !label.leftClusterId || !label.rightClusterId)) return null;
  const truth = new Map<string, string>();
  for (const label of labels) {
    truth.set(label.leftSourceObjectId, label.leftClusterId!);
    truth.set(label.rightSourceObjectId, label.rightClusterId!);
  }
  const objects = [...truth.keys()].sort();
  const predicted = new DisjointSet(objects);
  for (const [key, decision] of decisions) {
    if (decision.status !== "accepted") continue;
    const [left, right] = key.split("\u0000");
    if (left && right && truth.has(left) && truth.has(right)) predicted.union(left, right);
  }
  const clusters = new Map<string, string[]>();
  for (const objectId of objects) {
    const root = predicted.find(objectId);
    clusters.set(root, [...(clusters.get(root) ?? []), objectId]);
  }
  let majority = 0;
  for (const members of clusters.values()) {
    const counts = new Map<string, number>();
    for (const objectId of members) {
      const clusterId = truth.get(objectId)!;
      counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
    }
    majority += Math.max(...counts.values());
  }
  return { purity: majority / objects.length, clusters: clusters.size, objects: objects.length };
}

export function evaluateIdentityDecisions(
  decisions: ResolutionDecision[],
  labels: IdentityPairLabel[],
) {
  const superseded = new Set(
    decisions
      .filter((decision) => decision.status === "reversed" && decision.supersedesDecisionId)
      .map((decision) => decision.supersedesDecisionId!),
  );
  const activeByPair = new Map<string, ResolutionDecision>();
  for (const decision of decisions) {
    if (decision.status === "reversed" || superseded.has(decision.id)) continue;
    const key = identityPairId(...decision.candidateSourceObjectIds);
    if (activeByPair.has(key)) throw new TypeError(`Multiple active identity decisions for ${key}`);
    activeByPair.set(key, decision);
  }
  const seenLabels = new Set<string>();
  const evaluated = labels.map((label) => {
    if (!label.rationale.trim()) throw new TypeError("Identity labels require an audit rationale");
    const key = identityPairId(label.leftSourceObjectId, label.rightSourceObjectId);
    if (seenLabels.has(key)) throw new TypeError(`Duplicate identity label for ${key}`);
    seenLabels.add(key);
    const decision = activeByPair.get(key);
    return {
      key,
      label,
      decision,
      expected: label.sameEntity,
      predicted: decision?.status === "accepted",
    };
  });
  const strata = [...new Set(labels.map((label) => label.stratum))].sort();
  const signalKinds = [...new Set(evaluated.flatMap((row) => row.decision?.signals.map((signal) => signal.kind) ?? []))].sort();
  const constraintKinds = [...new Set(evaluated.flatMap((row) => row.decision?.constraints ?? []))].sort();
  return {
    auditedPairs: labels.length,
    positivePairs: labels.filter((label) => label.sameEntity).length,
    negativePairs: labels.filter((label) => !label.sameEntity).length,
    unmatchedLabels: evaluated.filter((row) => !row.decision).length,
    decisions: {
      accepted: decisions.filter((decision) => decision.status === "accepted").length,
      rejected: decisions.filter((decision) => decision.status === "rejected").length,
      pending: decisions.filter((decision) => decision.status === "pending").length,
      reversed: decisions.filter((decision) => decision.status === "reversed").length,
    },
    pairwise: quality(evaluated),
    byStratum: Object.fromEntries(strata.map((stratum) => [
      stratum,
      quality(evaluated.filter((row) => row.label.stratum === stratum)),
    ])),
    bySignal: Object.fromEntries(signalKinds.map((signal) => [
      signal,
      quality(evaluated.filter((row) => row.decision?.signals.some((item) => item.kind === signal))),
    ])),
    byConstraint: Object.fromEntries(constraintKinds.map((constraint) => [
      constraint,
      quality(evaluated.filter((row) => row.decision?.constraints.includes(constraint))),
    ])),
    errors: {
      falseMerges: evaluated.filter((row) => !row.expected && row.predicted).map((row) => row.key),
      falseSplits: evaluated.filter((row) => row.expected && !row.predicted).map((row) => row.key),
    },
    bCubed: bCubed(labels, activeByPair),
    clusterPurity: clusterPurity(labels, activeByPair),
  };
}

const strata = new Set<IdentityAuditStratum>([
  "exact_identifier",
  "alias_or_verified_link",
  "name_similarity",
  "conflicting_verified_identifiers",
  "different_surface_same_person",
  "same_name_different_company",
  "same_name_different_role",
  "ambiguous_alias",
  "transitive_cluster",
  "high_degree_identity",
  "missing_identifier",
]);

export function parseIdentityAuditLabels(value: unknown): {
  schemaVersion: 1;
  dataset: "Salesforce HERB";
  labels: IdentityPairLabel[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Identity audit labels must be an object");
  }
  const artifact = value as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || artifact.dataset !== "Salesforce HERB" || !Array.isArray(artifact.labels)) {
    throw new TypeError("Identity audit labels require schemaVersion 1 and Salesforce HERB");
  }
  const labels = artifact.labels.map((item, index): IdentityPairLabel => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`Identity label ${index} must be an object`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.leftSourceObjectId !== "string" ||
      typeof row.rightSourceObjectId !== "string" ||
      typeof row.sameEntity !== "boolean" ||
      typeof row.stratum !== "string" ||
      !strata.has(row.stratum as IdentityAuditStratum) ||
      typeof row.rationale !== "string" ||
      row.rationale.trim() === "" ||
      (row.leftClusterId !== undefined && typeof row.leftClusterId !== "string") ||
      (row.rightClusterId !== undefined && typeof row.rightClusterId !== "string")
    ) {
      throw new TypeError(`Identity label ${index} is malformed`);
    }
    return {
      leftSourceObjectId: row.leftSourceObjectId,
      rightSourceObjectId: row.rightSourceObjectId,
      sameEntity: row.sameEntity,
      stratum: row.stratum as IdentityAuditStratum,
      rationale: row.rationale,
      ...(typeof row.leftClusterId === "string" ? { leftClusterId: row.leftClusterId } : {}),
      ...(typeof row.rightClusterId === "string" ? { rightClusterId: row.rightClusterId } : {}),
    };
  });
  const keys = labels.map((label) => identityPairId(label.leftSourceObjectId, label.rightSourceObjectId));
  if (new Set(keys).size !== keys.length) throw new TypeError("Identity audit labels contain duplicate pairs");
  return { schemaVersion: 1, dataset: "Salesforce HERB", labels };
}
