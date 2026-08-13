import type { JsonValue, NormalizedSourceObject } from "@/ingestion/source-adapter";

export type DuplicateClassification =
  | "exact_duplicate"
  | "near_duplicate"
  | "version_candidate"
  | "distinct";

export interface DuplicateDecision {
  leftSourceObjectId: string;
  rightSourceObjectId: string;
  classification: DuplicateClassification;
  reasons: string[];
}

function normalizeValue(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return value;
}

export function classifyDuplicate(
  left: NormalizedSourceObject,
  right: NormalizedSourceObject,
): DuplicateDecision {
  const base = {
    leftSourceObjectId: left.id,
    rightSourceObjectId: right.id,
  };

  if (left.payloadDigest === right.payloadDigest) {
    return {
      ...base,
      classification: "exact_duplicate",
      reasons: ["payload_digest_equal"],
    };
  }

  if (
    left.sourceSystem === right.sourceSystem &&
    left.sourceObjectType === right.sourceObjectType &&
    left.sourceNativeId === right.sourceNativeId
  ) {
    return {
      ...base,
      classification: "version_candidate",
      reasons: ["same_source_native_id", "payload_digest_changed"],
    };
  }

  if (
    left.sourceObjectType === right.sourceObjectType &&
    JSON.stringify(normalizeValue(left.fields)) ===
      JSON.stringify(normalizeValue(right.fields))
  ) {
    return {
      ...base,
      classification: "near_duplicate",
      reasons: ["normalized_fields_equal"],
    };
  }

  return { ...base, classification: "distinct", reasons: [] };
}
