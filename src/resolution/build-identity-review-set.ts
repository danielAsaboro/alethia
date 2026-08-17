import { createHash } from "node:crypto";

import type { JsonValue, NormalizedSourceObject } from "@/ingestion/source-adapter";
import type { ResolutionDecision } from "./resolve-entities";

interface ReviewSource {
  sourceObjectId: string;
  sourceSystem: string;
  sourceNativeId: string;
  sourceObjectType: string;
  employeeId: string | null;
  externalIdentifiers: Array<{ namespace: string; value: string }>;
  name: string | null;
  role: string | null;
  organization: string | null;
  location: string | null;
  payloadDigest: string;
}

export interface IdentityReviewCandidate {
  pairId: string;
  left: ReviewSource;
  right: ReviewSource;
}

function scalar(value: JsonValue | undefined): string | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;
}

function source(record: NormalizedSourceObject): ReviewSource {
  return {
    sourceObjectId: record.id,
    sourceSystem: record.sourceSystem,
    sourceNativeId: record.sourceNativeId,
    sourceObjectType: record.sourceObjectType,
    employeeId: scalar(record.fields.employeeId ?? record.fields.employee_id),
    externalIdentifiers: record.identities
      .filter((identity) => identity.kind === "external_id")
      .map((identity) => ({ namespace: identity.sourceSystem, value: identity.normalizedValue }))
      .sort((left, right) => left.namespace.localeCompare(right.namespace) || left.value.localeCompare(right.value)),
    name: scalar(record.fields.name),
    role: scalar(record.fields.role),
    organization: scalar(record.fields.org ?? record.fields.organization),
    location: scalar(record.fields.location),
    payloadDigest: record.payloadDigest,
  };
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildIdentityReviewSet(
  records: NormalizedSourceObject[],
  decisions: ResolutionDecision[],
  requestedPairs: number,
) {
  if (!Number.isInteger(requestedPairs) || requestedPairs <= 0) {
    throw new TypeError("Identity review size must be a positive integer");
  }
  const superseded = new Set(decisions.flatMap((item) => item.supersedesDecisionId ? [item.supersedesDecisionId] : []));
  const active = decisions.filter((item) => item.status !== "reversed" && !superseded.has(item.id));
  if (active.length < requestedPairs) {
    throw new TypeError(`Requested ${requestedPairs} pairs but only ${active.length} real resolver candidates exist`);
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const rank: Record<ResolutionDecision["status"], number> = { accepted: 0, pending: 1, rejected: 2, reversed: 3 };
  const selected = [...active]
    .sort((left, right) => rank[left.status] - rank[right.status] || left.id.localeCompare(right.id))
    .slice(0, requestedPairs);
  const candidates = selected.map((decision): IdentityReviewCandidate => {
    const ids = [...decision.candidateSourceObjectIds].sort() as [string, string];
    const left = recordsById.get(ids[0]);
    const right = recordsById.get(ids[1]);
    if (!left || !right) throw new TypeError(`Resolver candidate references a missing source object: ${ids.join(", ")}`);
    return { pairId: sha256(ids), left: source(left), right: source(right) };
  });
  return {
    schemaVersion: 1,
    dataset: "Salesforce HERB",
    labelBlind: true,
    requestedPairs,
    availableResolverCandidates: active.length,
    runtimeDecisionDigest: sha256(active.map((item) => ({ id: item.id, inputDigest: item.inputDigest, algorithmVersion: item.algorithmVersion })).sort((a, b) => a.id.localeCompare(b.id))),
    candidates,
  };
}
