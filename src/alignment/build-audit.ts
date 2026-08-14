import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import { decideAlignment, type AlignmentDecision, type AlignmentRule, type OntologyTerm } from "./alignment-policy";
import { createSourceSchemaTerm, naiveFieldNameAlignment, type SourceSchemaTerm } from "./source-terms";

export interface AlignmentObservationSpec {
  questionId: string;
  documentId: string;
  sourceSystem: string;
  objectType: string;
  surface: string;
  contextualRole: string;
}

export interface AlignmentAudit {
  sourceTerms: SourceSchemaTerm[];
  ontologyTerms: OntologyTerm[];
  rules: AlignmentRule[];
  decisions: AlignmentDecision[];
  observations: Array<{ sourceObjectId: string; sourceTermId: string }>;
  baseline: Array<{ sourceTermId: string; naiveMapping: string; acceptedMapping: string }>;
}

const ontologyByName: Record<string, OntologyTerm> = {
  FILE_OWNER: { id: "ontology_file_owner", name: "FILE_OWNER", domain: "Document", range: "Person" },
  MEETING_OWNER: { id: "ontology_meeting_owner", name: "MEETING_OWNER", domain: "Meeting", range: "Person" },
  ACCOUNT_OWNER: { id: "ontology_account_owner", name: "ACCOUNT_OWNER", domain: "Account", range: "Person" },
  OPPORTUNITY_OWNER: { id: "ontology_opportunity_owner", name: "OPPORTUNITY_OWNER", domain: "Opportunity", range: "Person" },
  WORK_ITEM_ASSIGNEE: { id: "ontology_work_item_assignee", name: "WORK_ITEM_ASSIGNEE", domain: "WorkItem", range: "Person" },
};

const rejectedGeneric: OntologyTerm = {
  id: "ontology_generic_owns",
  name: "OWNS",
  domain: "Entity",
  range: "Entity",
};

export function buildAlignmentAudit(
  records: NormalizedSourceObject[],
  specs: AlignmentObservationSpec[],
): AlignmentAudit {
  const sourceTerms = new Map<string, SourceSchemaTerm>();
  const observations: AlignmentAudit["observations"] = [];
  for (const spec of specs) {
    const term = createSourceSchemaTerm(spec);
    if (term.canonicalHint === "UNMAPPED") {
      throw new TypeError(`No source-aware hint for ${term.id}`);
    }
    sourceTerms.set(term.id, term);
    const matches = records.filter(
      (record) => record.sourceNativeId === spec.documentId && record.sourceSystem === spec.sourceSystem,
    );
    if (matches.length === 0) throw new TypeError(`Missing canonical source ${spec.documentId}`);
    for (const record of matches) observations.push({ sourceObjectId: record.id, sourceTermId: term.id });
  }
  const terms = [...sourceTerms.values()].sort((a, b) => a.id.localeCompare(b.id));
  const acceptedOntology = terms.map((term) => ontologyByName[term.canonicalHint]).filter(Boolean);
  const ontologyTerms = [...new Map([...acceptedOntology, rejectedGeneric].map((term) => [term.id, term])).values()];
  const rules = terms.map((term): AlignmentRule => {
    const target = ontologyByName[term.canonicalHint];
    return {
      id: `rule_${term.sourceSystem}_${term.objectType}_${term.normalizedSurface}_v1`,
      version: "alignment-registry-v1",
      sourceSystem: term.sourceSystem,
      objectType: term.objectType,
      surface: term.normalizedSurface,
      contextualRole: term.contextualRole,
      targetOntologyTermId: target.id,
      domain: target.domain,
      range: target.range,
    };
  });
  const decisions = terms.flatMap((term) => {
    const evidenceObservationIds = specs
      .filter((spec) => createSourceSchemaTerm(spec).id === term.id)
      .map((spec) => spec.questionId)
      .sort();
    return [
      decideAlignment({ term, candidate: ontologyByName[term.canonicalHint], evidenceObservationIds }, rules),
      decideAlignment({ term, candidate: rejectedGeneric, evidenceObservationIds }, rules),
    ];
  });
  return {
    sourceTerms: terms,
    ontologyTerms,
    rules,
    decisions,
    observations,
    baseline: terms.map((term) => ({
      sourceTermId: term.id,
      naiveMapping: naiveFieldNameAlignment(term),
      acceptedMapping: term.canonicalHint,
    })),
  };
}
