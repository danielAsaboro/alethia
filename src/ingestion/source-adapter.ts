import type { ContentScope, CoverageSlice } from "@/domain/ontology";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface IdentityObservation {
  kind: "external_id" | "email" | "name" | "handle";
  value: string;
  normalizedValue: string;
  sourceSystem: string;
}

export interface NormalizedSourceObject {
  id: string;
  sourceSystem: string;
  sourceObjectType: string;
  sourceNativeId: string;
  sourcePath: string;
  contentScope: ContentScope;
  payloadDigest: string;
  fields: Record<string, JsonValue>;
  identities: IdentityObservation[];
}

export interface RejectedRecord {
  id: string;
  sourcePath: string;
  sourceNativeId?: string;
  reason: "invalid_shape" | "invalid_json" | "unsupported_input";
  detail: string;
}

export type AdapterEvent =
  | { type: "record"; record: NormalizedSourceObject }
  | { type: "rejected"; rejected: RejectedRecord }
  | { type: "coverage"; slice: CoverageSlice };

export interface SourceAdapter {
  readonly sourceSystem: string;
  readonly objectType: string;
  readonly version: string;
  read(inputPath: string): AsyncIterable<AdapterEvent>;
}

export interface IngestionBundle {
  adapter: {
    sourceSystem: string;
    objectType: string;
    version: string;
  };
  records: NormalizedSourceObject[];
  rejected: RejectedRecord[];
  coverage: CoverageSlice[];
  summary: {
    records: number;
    rejected: number;
    coverageSlices: number;
    completeCoverageSlices: number;
  };
}
