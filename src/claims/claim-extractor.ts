import type { Claim } from "@/domain/ontology";
import type { NormalizedSourceObject } from "@/ingestion/source-adapter";

export interface ReferencedEntity {
  id: string;
  kind: "organization";
  name: string;
}

export interface ExtractionGap {
  predicate: string;
  externalId: string;
  reason: "subject_unresolved" | "object_unresolved" | "unsupported_object_type";
}

export interface ExtractionResult {
  claims: Claim[];
  referencedEntities: ReferencedEntity[];
  gaps: ExtractionGap[];
}

export interface ExtractionContext {
  entityBySourceObjectId: ReadonlyMap<string, string>;
  entityByExternalId: ReadonlyMap<string, string>;
}

export interface ClaimExtractor {
  extract(
    object: NormalizedSourceObject,
    context: ExtractionContext,
  ): Promise<ExtractionResult>;
}
