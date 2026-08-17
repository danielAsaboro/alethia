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
  RECORD_TITLE: { id: "ontology_record_title", name: "RECORD_TITLE", domain: "EnterpriseRecord", range: "Text" },
  RECORD_BODY: { id: "ontology_record_body", name: "RECORD_BODY", domain: "EnterpriseRecord", range: "Text" },
  RECORD_SUMMARY: { id: "ontology_record_summary", name: "RECORD_SUMMARY", domain: "EnterpriseRecord", range: "Text" },
  OBJECTIVE: { id: "ontology_objective", name: "OBJECTIVE", domain: "EnterpriseRecord", range: "Text" },
  SCOPE: { id: "ontology_scope", name: "SCOPE", domain: "EnterpriseRecord", range: "Text" },
  REQUIREMENT: { id: "ontology_requirement", name: "REQUIREMENT", domain: "EnterpriseRecord", range: "Text" },
  PROCEDURE: { id: "ontology_procedure", name: "PROCEDURE", domain: "EnterpriseRecord", range: "Text" },
  DISCUSSION: { id: "ontology_discussion", name: "DISCUSSION", domain: "EnterpriseRecord", range: "Text" },
  TIMESTAMP: { id: "ontology_timestamp", name: "TIMESTAMP", domain: "EnterpriseRecord", range: "Instant" },
  AUTHOR: { id: "ontology_author", name: "AUTHOR", domain: "EnterpriseRecord", range: "Person" },
  RECIPIENT: { id: "ontology_recipient", name: "RECIPIENT", domain: "EnterpriseRecord", range: "Person" },
  SUBJECT: { id: "ontology_subject", name: "SUBJECT", domain: "EnterpriseRecord", range: "Text" },
  NEXT_STEP: { id: "ontology_next_step", name: "NEXT_STEP", domain: "EnterpriseRecord", range: "Action" },
  IMPACT: { id: "ontology_impact", name: "IMPACT", domain: "EnterpriseRecord", range: "Text" },
  ROOT_CAUSE: { id: "ontology_root_cause", name: "ROOT_CAUSE", domain: "EnterpriseRecord", range: "Text" },
  MOTIVATION: { id: "ontology_motivation", name: "MOTIVATION", domain: "EnterpriseRecord", range: "Text" },
  RELEASE_NOTE: { id: "ontology_release_note", name: "RELEASE_NOTE", domain: "EnterpriseRecord", range: "Text" },
  TERMINOLOGY: { id: "ontology_terminology", name: "TERMINOLOGY", domain: "EnterpriseRecord", range: "Text" },
  LEAD_SOURCE: { id: "ontology_lead_source", name: "LEAD_SOURCE", domain: "EnterpriseRecord", range: "Text" },
  TRANSCRIPT: { id: "ontology_transcript", name: "TRANSCRIPT", domain: "EnterpriseRecord", range: "Text" },
  TOPIC: { id: "ontology_topic", name: "TOPIC", domain: "EnterpriseRecord", range: "Text" },
  CHANNEL: { id: "ontology_channel", name: "CHANNEL", domain: "EnterpriseRecord", range: "Text" },
  MESSAGE: { id: "ontology_message", name: "MESSAGE", domain: "EnterpriseRecord", range: "Text" },
  CODE_BLOCK: { id: "ontology_code_block", name: "CODE_BLOCK", domain: "EnterpriseRecord", range: "Text" },
  AUDIENCE: { id: "ontology_audience", name: "AUDIENCE", domain: "EnterpriseRecord", range: "Group" },
  ASSESSMENT: { id: "ontology_assessment", name: "ASSESSMENT", domain: "EnterpriseRecord", range: "Text" },
  OBSERVABILITY: { id: "ontology_observability", name: "OBSERVABILITY", domain: "EnterpriseRecord", range: "Text" },
  ACTIVITY_TIMELINE: { id: "ontology_activity_timeline", name: "ACTIVITY_TIMELINE", domain: "EnterpriseRecord", range: "Text" },
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
  const rules = terms.filter((term) => term.canonicalHint !== "UNMAPPED").map((term): AlignmentRule => {
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
    const target = ontologyByName[term.canonicalHint];
    return target
      ? [
          decideAlignment({ term, candidate: target, evidenceObservationIds }, rules),
          decideAlignment({ term, candidate: rejectedGeneric, evidenceObservationIds }, rules),
        ]
      : [decideAlignment({ term, candidate: rejectedGeneric, evidenceObservationIds }, rules)];
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
