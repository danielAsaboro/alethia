import { stableId } from "@/domain/ids";
import type { Claim, ClaimObject } from "@/domain/ontology";
import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import type { ResolutionBundle } from "@/resolution/resolve-entities";
import type {
  ClaimExtractor,
  ExtractionContext,
  ExtractionGap,
  ExtractionResult,
  ReferencedEntity,
} from "./claim-extractor";

const extractorVersion = "herb-structural-v2";

function externalKey(sourceSystem: string, value: string): string {
  return `${sourceSystem}:${value.trim().toLocaleLowerCase("en-US")}`;
}

export function createExtractionContext(
  objects: NormalizedSourceObject[],
  resolution: ResolutionBundle,
): ExtractionContext {
  const entityBySourceObjectId = new Map<string, string>();
  for (const entity of resolution.entities) {
    for (const sourceObjectId of entity.sourceObjectIds) {
      entityBySourceObjectId.set(sourceObjectId, entity.id);
    }
  }

  const entityByExternalId = new Map<string, string>();
  for (const object of objects) {
    const entityId = entityBySourceObjectId.get(object.id);
    if (!entityId) continue;
    for (const identity of object.identities) {
      if (identity.kind === "external_id") {
        entityByExternalId.set(
          externalKey(identity.sourceSystem, identity.normalizedValue),
          entityId,
        );
      }
    }
  }

  return { entityBySourceObjectId, entityByExternalId };
}

function claim(
  source: NormalizedSourceObject,
  subjectEntityId: string,
  predicate: string,
  object: ClaimObject,
): Claim {
  return {
    id: stableId("claim", {
      subjectEntityId,
      predicate,
      object,
      sourceObjectId: source.id,
      extractorVersion,
    }),
    subjectEntityId,
    predicate,
    object,
    sourceObjectId: source.id,
    sourceSystem: source.sourceSystem,
    extractionMethod: "deterministic",
    extractorVersion,
  };
}

function stringField(
  source: NormalizedSourceObject,
  key: string,
): string | undefined {
  const value = source.fields[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(
  source: NormalizedSourceObject,
  key: string,
): string[] {
  const value = source.fields[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function organizationEntity(name: string): ReferencedEntity {
  return {
    id: stableId("entity", {
      kind: "organization",
      normalizedName: name.trim().toLocaleLowerCase("en-US"),
    }),
    kind: "organization",
    name,
  };
}

function resolveExternalClaims(input: {
  source: NormalizedSourceObject;
  subjectEntityId: string;
  predicate: string;
  externalIdNamespace: string;
  externalIds: string[];
  context: ExtractionContext;
}): { claims: Claim[]; gaps: ExtractionGap[] } {
  const claims: Claim[] = [];
  const gaps: ExtractionGap[] = [];
  for (const externalId of input.externalIds) {
    const entityId = input.context.entityByExternalId.get(
      externalKey(input.externalIdNamespace, externalId),
    );
    if (!entityId) {
      gaps.push({
        predicate: input.predicate,
        externalId,
        reason: "object_unresolved",
      });
    } else {
      claims.push(
        claim(input.source, input.subjectEntityId, input.predicate, {
          kind: "entity",
          entityId,
        }),
      );
    }
  }
  return { claims, gaps };
}

export class DeterministicClaimExtractor implements ClaimExtractor {
  async extract(
    source: NormalizedSourceObject,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    const subjectEntityId = context.entityBySourceObjectId.get(source.id);
    if (!subjectEntityId) {
      return {
        claims: [],
        referencedEntities: [],
        gaps: [
          {
            predicate: "*",
            externalId: source.sourceNativeId,
            reason: "subject_unresolved",
          },
        ],
      };
    }

    const claims: Claim[] = [];
    const referencedEntities: ReferencedEntity[] = [];
    const gaps: ExtractionGap[] = [];
    const name = stringField(source, "name") ?? stringField(source, "productName");
    if (name) {
      claims.push(
        claim(source, subjectEntityId, "display_name", {
          kind: "literal",
          value: name,
        }),
      );
    }

    if (source.sourceObjectType === "employee") {
      const role = stringField(source, "role");
      const location = stringField(source, "location");
      const organization = stringField(source, "organization");
      if (role) claims.push(claim(source, subjectEntityId, "has_role", { kind: "literal", value: role }));
      if (location) claims.push(claim(source, subjectEntityId, "located_in", { kind: "literal", value: location }));
      if (organization) {
        const entity = organizationEntity(organization);
        referencedEntities.push(entity);
        claims.push(claim(source, subjectEntityId, "member_of", { kind: "entity", entityId: entity.id }));
      }
    } else if (source.sourceObjectType === "customer") {
      const role = stringField(source, "role");
      const company = stringField(source, "company");
      if (role) claims.push(claim(source, subjectEntityId, "has_role", { kind: "literal", value: role }));
      if (company) {
        const entity = organizationEntity(company);
        referencedEntities.push(entity);
        claims.push(claim(source, subjectEntityId, "works_at", { kind: "entity", entityId: entity.id }));
      }
    } else if (source.sourceObjectType === "product") {
      for (const relation of [
        { field: "teamIds", predicate: "has_team_member", externalIdNamespace: "herb:person" },
        { field: "customerIds", predicate: "serves_customer", externalIdNamespace: "herb:customer" },
      ]) {
        const result = resolveExternalClaims({
          source,
          subjectEntityId,
          predicate: relation.predicate,
          externalIdNamespace: relation.externalIdNamespace,
          externalIds: stringArrayField(source, relation.field),
          context,
        });
        claims.push(...result.claims);
        gaps.push(...result.gaps);
      }
    } else if (source.sourceObjectType === "team_structure") {
      const result = resolveExternalClaims({
        source,
        subjectEntityId,
        predicate: "manages",
        externalIdNamespace: "herb:person",
        externalIds: stringArrayField(source, "directAndNestedReportIds"),
        context,
      });
      claims.push(...result.claims);
      gaps.push(...result.gaps);
    } else {
      gaps.push({
        predicate: "*",
        externalId: source.sourceNativeId,
        reason: "unsupported_object_type",
      });
    }

    return { claims, referencedEntities, gaps };
  }
}
