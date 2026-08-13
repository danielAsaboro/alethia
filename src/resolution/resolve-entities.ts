import { stableId } from "@/domain/ids";
import type {
  IdentityObservation,
  NormalizedSourceObject,
} from "@/ingestion/source-adapter";
import { identityKey } from "./normalize-identity";

export interface ResolutionSignal {
  kind: "external_id_exact" | "email_exact" | "name_exact";
  normalizedValue: string;
}

export interface ResolutionDecision {
  id: string;
  status: "accepted" | "rejected" | "reversed";
  candidateSourceObjectIds: [string, string];
  signals: ResolutionSignal[];
  constraints: string[];
  confidence: number;
  algorithmVersion: "resolver-v1";
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

interface CandidateAssessment {
  signal: ResolutionSignal;
  status: "accepted" | "rejected";
  constraints: string[];
  confidence: number;
}

function sharedIdentity(
  left: IdentityObservation[],
  right: IdentityObservation[],
): CandidateAssessment | null {
  for (const leftIdentity of left.filter((item) => item.kind === "email")) {
    if (
      right.some(
        (item) =>
          item.kind === "email" &&
          item.normalizedValue === leftIdentity.normalizedValue,
      )
    ) {
      return {
        signal: {
          kind: "email_exact",
          normalizedValue: leftIdentity.normalizedValue,
        },
        status: "accepted",
        constraints: ["cross_source_email_allowed"],
        confidence: 0.99,
      };
    }
  }

  for (const leftIdentity of left.filter(
    (item) => item.kind === "external_id",
  )) {
    if (
      right.some(
        (item) =>
          item.kind === "external_id" &&
          item.sourceSystem === leftIdentity.sourceSystem &&
          item.normalizedValue === leftIdentity.normalizedValue,
      )
    ) {
      return {
        signal: {
          kind: "external_id_exact",
          normalizedValue: leftIdentity.normalizedValue,
        },
        status: "accepted",
        constraints: ["same_identity_namespace"],
        confidence: 1,
      };
    }
  }

  for (const leftIdentity of left.filter((item) => item.kind === "name")) {
    if (
      right.some(
        (item) =>
          item.kind === "name" &&
          item.normalizedValue === leftIdentity.normalizedValue,
      )
    ) {
      return {
        signal: {
          kind: "name_exact",
          normalizedValue: leftIdentity.normalizedValue,
        },
        status: "rejected",
        constraints: ["name_not_unique"],
        confidence: 0.35,
      };
    }
  }

  return null;
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
): ResolutionBundle {
  const sorted = [...objects].sort((left, right) => left.id.localeCompare(right.id));
  const decisions: ResolutionDecision[] = [];

  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      const left = sorted[leftIndex];
      const right = sorted[rightIndex];
      const assessment = sharedIdentity(left.identities, right.identities);
      if (!assessment) continue;
      const candidateSourceObjectIds: [string, string] = [left.id, right.id];
      decisions.push({
        id: stableId("resolution_decision", {
          algorithmVersion: "resolver-v1",
          candidateSourceObjectIds,
          signal: assessment.signal,
          status: assessment.status,
        }),
        status: assessment.status,
        candidateSourceObjectIds,
        signals: [assessment.signal],
        constraints: assessment.constraints,
        confidence: assessment.confidence,
        algorithmVersion: "resolver-v1",
      });
    }
  }

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
    algorithmVersion: "resolver-v1",
    supersedesDecisionId: target.id,
  };
  const decisions = [...bundle.decisions, reversal];
  return {
    entities: buildEntities(objects, activeDecisions),
    decisions,
  };
}
