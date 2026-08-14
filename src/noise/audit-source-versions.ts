import type { EvidenceGraphSourceRelation } from "@/hydra/evidence-graph";
import type { NormalizedSourceObject } from "@/ingestion/source-adapter";

export interface DivergentSourceVersionGroup {
  sourceSystem: string;
  sourceNativeId: string;
  sourceObjectIds: string[];
  payloadDigests: string[];
  chronologyKnown: false;
}

export interface SourceVersionAudit {
  groups: DivergentSourceVersionGroup[];
  relations: EvidenceGraphSourceRelation[];
}

export function auditSourceVersions(
  sources: NormalizedSourceObject[],
): SourceVersionAudit {
  const candidates = new Map<string, NormalizedSourceObject[]>();
  for (const source of sources) {
    const key = `${source.sourceSystem}\u0000${source.sourceNativeId}`;
    candidates.set(key, [...(candidates.get(key) ?? []), source]);
  }

  const groups: DivergentSourceVersionGroup[] = [];
  const relations: EvidenceGraphSourceRelation[] = [];
  for (const candidatesForId of candidates.values()) {
    const byDigest = new Map<string, NormalizedSourceObject>();
    for (const source of candidatesForId) {
      const prior = byDigest.get(source.payloadDigest);
      if (!prior || source.id.localeCompare(prior.id) < 0) {
        byDigest.set(source.payloadDigest, source);
      }
    }
    const versions = [...byDigest.values()].sort(
      (left, right) =>
        left.payloadDigest.localeCompare(right.payloadDigest) ||
        left.id.localeCompare(right.id),
    );
    if (versions.length < 2) continue;

    const anchor = versions[0];
    groups.push({
      sourceSystem: anchor.sourceSystem,
      sourceNativeId: anchor.sourceNativeId,
      sourceObjectIds: versions.map((source) => source.id).sort(),
      payloadDigests: versions.map((source) => source.payloadDigest).sort(),
      chronologyKnown: false,
    });
    for (const version of versions.slice(1)) {
      relations.push({
        type: "VERSION_OF",
        sourceObjectId: version.id,
        targetSourceObjectId: anchor.id,
        reason: "same_native_id_divergent_digest",
        orderKnown: false,
      });
    }
  }

  return {
    groups: groups.sort(
      (left, right) =>
        left.sourceSystem.localeCompare(right.sourceSystem) ||
        left.sourceNativeId.localeCompare(right.sourceNativeId),
    ),
    relations: relations.sort((left, right) =>
      left.sourceObjectId.localeCompare(right.sourceObjectId),
    ),
  };
}
