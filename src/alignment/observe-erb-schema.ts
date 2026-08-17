import type { NormalizedSourceObject } from "@/ingestion/source-adapter";
import type { AlignmentObservationSpec } from "./build-audit";

interface FieldSpec {
  surface: string;
  contextualRole: string;
  observedBy: "canonical_field" | "section_label" | "email_header" | "slack_structure";
}

const common: FieldSpec[] = [
  { surface: "title", contextualRole: "record_title", observedBy: "canonical_field" },
  { surface: "content", contextualRole: "record_body", observedBy: "canonical_field" },
];

const catalog: Record<string, FieldSpec[]> = {
  github: [
    { surface: "description", contextualRole: "record_body", observedBy: "section_label" },
    { surface: "Motivation", contextualRole: "motivation", observedBy: "section_label" },
    { surface: "review_thread", contextualRole: "discussion", observedBy: "section_label" },
    { surface: "release_notes", contextualRole: "release_note", observedBy: "section_label" },
    { surface: "QA", contextualRole: "ambiguous", observedBy: "section_label" },
  ],
  linear: [
    { surface: "description", contextualRole: "record_body", observedBy: "section_label" },
    { surface: "Objective", contextualRole: "objective", observedBy: "section_label" },
    { surface: "Scope", contextualRole: "scope", observedBy: "section_label" },
    { surface: "Migration plan", contextualRole: "procedure", observedBy: "section_label" },
    { surface: "Note", contextualRole: "ambiguous", observedBy: "section_label" },
  ],
  fireflies: [
    { surface: "summary", contextualRole: "record_summary", observedBy: "section_label" },
    { surface: "topics", contextualRole: "topic", observedBy: "section_label" },
    { surface: "next_steps", contextualRole: "next_step", observedBy: "section_label" },
    { surface: "transcript", contextualRole: "transcript", observedBy: "section_label" },
    { surface: "Meeting header", contextualRole: "ambiguous", observedBy: "section_label" },
  ],
  gmail: [
    { surface: "From", contextualRole: "author", observedBy: "email_header" },
    { surface: "To", contextualRole: "recipient", observedBy: "email_header" },
    { surface: "Date", contextualRole: "timestamp", observedBy: "email_header" },
    { surface: "Subject", contextualRole: "subject", observedBy: "email_header" },
  ],
  google_drive: [
    { surface: "Goals", contextualRole: "objective", observedBy: "section_label" },
    { surface: "Non-goals", contextualRole: "scope", observedBy: "section_label" },
    { surface: "Inputs / data model assumptions", contextualRole: "requirements", observedBy: "section_label" },
    { surface: "Operational / observability hooks", contextualRole: "observability", observedBy: "section_label" },
  ],
  confluence: [
    { surface: "Summary", contextualRole: "record_summary", observedBy: "section_label" },
    { surface: "Audience", contextualRole: "audience", observedBy: "section_label" },
    { surface: "Learning objectives (measurable)", contextualRole: "objective", observedBy: "section_label" },
    { surface: "Assessment and certification", contextualRole: "assessment", observedBy: "section_label" },
  ],
  jira: [
    { surface: "description", contextualRole: "record_body", observedBy: "section_label" },
    { surface: "steps_to_reproduce", contextualRole: "procedure", observedBy: "section_label" },
    { surface: "impact_summary", contextualRole: "impact", observedBy: "section_label" },
    { surface: "root_cause", contextualRole: "root_cause", observedBy: "section_label" },
  ],
  hubspot: [
    { surface: "notes", contextualRole: "record_body", observedBy: "section_label" },
    { surface: "Lead source", contextualRole: "lead_source", observedBy: "section_label" },
    { surface: "Key requirements", contextualRole: "requirements", observedBy: "section_label" },
    { surface: "activity_timeline", contextualRole: "activity_timeline", observedBy: "section_label" },
  ],
  slack: [
    { surface: "channel", contextualRole: "channel", observedBy: "slack_structure" },
    { surface: "author", contextualRole: "author", observedBy: "slack_structure" },
    { surface: "message", contextualRole: "message", observedBy: "slack_structure" },
    { surface: "code_block", contextualRole: "code_block", observedBy: "slack_structure" },
  ],
};

function body(record: NormalizedSourceObject): string {
  const value = record.fields.body;
  if (typeof value !== "string") throw new TypeError(`ERB record ${record.id} has no body`);
  return value.replace(/\\n/g, "\n");
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertObserved(record: NormalizedSourceObject, spec: FieldSpec): void {
  const content = body(record);
  if (spec.observedBy === "canonical_field") {
    const key = spec.surface === "content" ? "body" : spec.surface;
    if (typeof record.fields[key] !== "string") throw new TypeError(`Missing canonical field ${spec.surface}`);
    return;
  }
  if (spec.observedBy === "slack_structure") {
    const present = spec.surface === "channel"
      ? /^[^\n]+\n/.test(content)
      : spec.surface === "author"
        ? /(?:^|\n)[a-z][a-z0-9_-]*:\s/i.test(content)
        : spec.surface === "message"
          ? /:\s+\S/.test(content)
          : /```[\s\S]*?```/.test(content);
    if (!present) throw new TypeError(`Missing Slack structure ${spec.surface}`);
    return;
  }
  const pattern = spec.observedBy === "email_header"
    ? new RegExp(`(?:^|\\n|\\[')${escaped(spec.surface)}:\\s+`, "i")
    : new RegExp(`(?:^|\\n| \\| |^#+\\s*)${escaped(spec.surface)}(?:[ \\t]*:|[ \\t]*\\||\\r?\\n|$)`, "i");
  if (!pattern.test(content)) throw new TypeError(`Missing observed ${record.sourceSystem} field ${spec.surface}`);
}

export function observeErbSchema(records: NormalizedSourceObject[]): AlignmentObservationSpec[] {
  const seenSystems = new Set(records.map((record) => record.sourceSystem));
  const missing = Object.keys(catalog).filter((sourceSystem) => !seenSystems.has(sourceSystem));
  if (missing.length > 0) throw new TypeError(`Alignment corpus lacks source systems: ${missing.join(", ")}`);
  return records.flatMap((record) => [...common, ...catalog[record.sourceSystem]!].map((spec) => {
    assertObserved(record, spec);
    return {
      questionId: `schema:${record.sourceNativeId}:${spec.surface}`,
      documentId: record.sourceNativeId,
      sourceSystem: record.sourceSystem,
      objectType: record.sourceObjectType,
      surface: spec.surface,
      contextualRole: spec.contextualRole,
    };
  }));
}
