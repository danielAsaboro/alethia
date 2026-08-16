import { createHash } from "node:crypto";

import { stableId } from "@/domain/ids";
import type {
  IdentityObservation,
  NormalizedSourceObject,
} from "@/ingestion/source-adapter";
import { identityKey } from "./normalize-identity";
import { scoreIdentityCandidate } from "./score-identity-candidate";
import type { IdentityConstraint, IdentitySignal } from "./score-identity-candidate";

export interface ResolutionSignal {
  kind: IdentitySignal["kind"];
  normalizedValue: string;
}

export interface ResolutionDecision {
  id: string;
  status: "accepted" | "rejected" | "pending" | "reversed";
  candidateSourceObjectIds: [string, string];
  signals: ResolutionSignal[];
  constraints: string[];
  confidence: number;
  algorithmVersion: "resolver-v2";
  inputDigest: string;
  supersedesDecisionId?: string;
}

export interface CanonicalEntity {
  id: string;
  sourceObjectIds: string[];
  identityKeys: string[];
}

export interface ResolutionBundle {
  entities: CanonicalEntity[];
  decisions: ResolutionDecision[];
}

export interface VerifiedIdentityLink {
  leftSourceObjectId: string;
  rightSourceObjectId: string;
  reference: string;
}

function values(identities: IdentityObservation[], kind: IdentityObservation["kind"]): Set<string> {
  return new Set(identities.filter((item) => item.kind === kind).map((item) => item.normalizedValue));
}

function firstOverlap(left: Set<string>, right: Set<string>): string | undefined {
  return [...left].find((value) => right.has(value));
}

function resolutionInputDigest(
  left: NormalizedSourceObject,
  right: NormalizedSourceObject,
): string {
  const inputs = [left, right]
    .map((item) => ({ id: item.id, payloadDigest: item.payloadDigest }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256")
    .update(JSON.stringify({ algorithmVersion: "resolver-v2", inputs }))
    .digest("hex");
}

function assessCandidate(
  left: NormalizedSourceObject,
  right: NormalizedSourceObject,
  link?: VerifiedIdentityLink,
): ResolutionDecision | null {
  const signals: IdentitySignal[] = [];
  const constraints: IdentityConstraint[] = [];
  const sharedEmail = firstOverlap(values(left.identities, "email"), values(right.identities, "email"));
  if (sharedEmail) signals.push({ kind: "verified_email_exact", value: sharedEmail, weight: 1 });
  const sharedName = firstOverlap(values(left.identities, "name"), values(right.identities, "name"));
  if (sharedName) signals.push({ kind: "name_similarity", value: sharedName, weight: 0.35 });
  for (const identity of left.identities.filter((item) => item.kind === "external_id")) {
    if (right.identities.some((item) => item.kind === "external_id" && item.sourceSystem === identity.sourceSystem && item.normalizedValue === identity.normalizedValue)) {
      signals.push({ kind: "external_id_exact", value: identity.normalizedValue, weight: 1 });
      break;
    }
  }
  if (link) signals.push({ kind: "verified_account_link", value: link.reference, weight: 1 });
  if (signals.length === 0) return null;

  const leftEmails = values(left.identities, "email");
  const rightEmails = values(right.identities, "email");
  if (leftEmails.size > 0 && rightEmails.size > 0 && !firstOverlap(leftEmails, rightEmails)) {
    constraints.push({ kind: "verified_email_conflict", leftValue: [...leftEmails].sort()[0], rightValue: [...rightEmails].sort()[0] });
  }
  const namespaces = new Set(left.identities.filter((item) => item.kind === "external_id").map((item) => item.sourceSystem));
  for (const namespace of namespaces) {
    const leftIds = new Set(left.identities.filter((item) => item.kind === "external_id" && item.sourceSystem === namespace).map((item) => item.normalizedValue));
    const rightIds = new Set(right.identities.filter((item) => item.kind === "external_id" && item.sourceSystem === namespace).map((item) => item.normalizedValue));
    if (leftIds.size > 0 && rightIds.size > 0 && !firstOverlap(leftIds, rightIds)) {
      constraints.push({ kind: "employee_id_conflict", leftValue: [...leftIds].sort()[0], rightValue: [...rightIds].sort()[0] });
    }
  }
  const candidateSourceObjectIds: [string, string] = [left.id, right.id];
  const scored = scoreIdentityCandidate({ candidateSourceObjectIds, signals, constraints });
  return {
    id: scored.id,
    status: scored.status,
    candidateSourceObjectIds,
    signals: scored.signals.map((signal) => ({ kind: signal.kind, normalizedValue: signal.value })),
    constraints: scored.constraints.length > 0
      ? scored.constraints.map((constraint) => constraint.kind)
      : scored.status === "pending" ? ["name_not_unique"]
      : scored.signals.some((signal) => signal.kind === "verified_email_exact") ? ["cross_source_email_allowed"]
      : scored.signals.some((signal) => signal.kind === "external_id_exact") ? ["same_identity_namespace"]
      : ["verified_account_link"],
    confidence: scored.status === "pending" ? 0.35 : scored.score,
    algorithmVersion: "resolver-v2",
    inputDigest: resolutionInputDigest(left, right),
  };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) throw new Error(`Unknown source object: ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = [leftRoot, rightRoot].sort();
    this.parent.set(child, root);
  }
}

function buildEntities(
  objects: NormalizedSourceObject[],
  decisions: ResolutionDecision[],
): CanonicalEntity[] {
  const disjointSet = new DisjointSet(objects.map((object) => object.id));
  for (const decision of decisions) {
    if (decision.status === "accepted") {
      disjointSet.union(
        decision.candidateSourceObjectIds[0],
        decision.candidateSourceObjectIds[1],
      );
    }
  }

  const groups = new Map<string, NormalizedSourceObject[]>();
  for (const object of objects) {
    const root = disjointSet.find(object.id);
    groups.set(root, [...(groups.get(root) ?? []), object]);
  }

  return [...groups.values()]
    .map((group) => {
      const sourceObjectIds = group.map((object) => object.id).sort();
      const identityKeys = [
        ...new Set(
          group.flatMap((object) => object.identities.map(identityKey)),
        ),
      ].sort();
      return {
        id: stableId("entity", { sourceObjectIds }),
        sourceObjectIds,
        identityKeys,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveEntities(
  objects: NormalizedSourceObject[],
  options: { verifiedLinks?: VerifiedIdentityLink[] } = {},
): ResolutionBundle {
  const sorted = [...objects].sort((left, right) => left.id.localeCompare(right.id));
  const candidates: ResolutionDecision[] = [];

  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      const link = options.verifiedLinks?.find((candidate) =>
        (candidate.leftSourceObjectId === left.id && candidate.rightSourceObjectId === right.id) ||
        (candidate.leftSourceObjectId === right.id && candidate.rightSourceObjectId === left.id),
      );
      const decision = assessCandidate(left, right, link);
      if (decision) candidates.push(decision);
    }
  }

  const disjointSet = new DisjointSet(sorted.map((object) => object.id));
  const decisions = candidates.map((decision): ResolutionDecision => {
    if (decision.status !== "accepted") return decision;
    const [leftId, rightId] = decision.candidateSourceObjectIds;
    const leftRoot = disjointSet.find(leftId);
    const rightRoot = disjointSet.find(rightId);
    const clusterObjects = sorted.filter((object) => {
      const root = disjointSet.find(object.id);
      return root === leftRoot || root === rightRoot;
    });
    const identifiers = new Map<string, Set<string>>();
    for (const object of clusterObjects) {
      for (const identity of object.identities.filter((item) => item.kind === "external_id")) {
        const values = identifiers.get(identity.sourceSystem) ?? new Set<string>();
        values.add(identity.normalizedValue);
        identifiers.set(identity.sourceSystem, values);
      }
    }
    const conflict = [...identifiers.entries()].find(([, values]) => values.size > 1);
    if (conflict) {
      return {
        ...decision,
        id: stableId("resolution_decision", { supersedes: decision.id, constraint: "cluster_identity_conflict" }),
        status: "rejected",
        constraints: [...decision.constraints, "cluster_identity_conflict"],
        confidence: 0,
      };
    }
    disjointSet.union(leftId, rightId);
    return decision;
  });
  return { entities: buildEntities(sorted, decisions), decisions };
}

export function reverseResolution(
  objects: NormalizedSourceObject[],
  bundle: ResolutionBundle,
  decisionId: string,
): ResolutionBundle {
  const target = bundle.decisions.find((decision) => decision.id === decisionId);
  if (!target || target.status !== "accepted") {
    throw new TypeError(`Accepted resolution decision not found: ${decisionId}`);
  }

  const activeDecisions = bundle.decisions.filter(
    (decision) => decision.id !== decisionId,
  );
  const reversal: ResolutionDecision = {
    id: stableId("resolution_decision", {
      status: "reversed",
      supersedesDecisionId: target.id,
    }),
    status: "reversed",
    candidateSourceObjectIds: target.candidateSourceObjectIds,
    signals: target.signals,
    constraints: [...target.constraints, "explicit_reversal"],
    confidence: target.confidence,
    algorithmVersion: "resolver-v2",
    inputDigest: target.inputDigest,
    supersedesDecisionId: target.id,
  };
  const decisions = [...bundle.decisions, reversal];
  return {
    entities: buildEntities(objects, activeDecisions),
    decisions,
  };
}
