import { stableId } from "@/domain/ids";

export interface SourceSchemaTerm {
  id: string;
  sourceSystem: string;
  objectType: string;
  surface: string;
  normalizedSurface: string;
  contextualRole: string;
  canonicalHint: string;
}

const contextualHints: Record<string, string> = {
  "google_drive|document|owner|file_metadata": "FILE_OWNER",
  "hubspot|account|owner|sales_account": "ACCOUNT_OWNER",
  "hubspot|opportunity|owner|sales_opportunity": "OPPORTUNITY_OWNER",
  "fireflies|meeting|owner|meeting_metadata": "MEETING_OWNER",
  "jira|issue|assignee|work_item_assignment": "WORK_ITEM_ASSIGNEE",
  "github|pull_request|reviewer|code_review_request": "CODE_REVIEWER",
};

function normalizeSurface(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createSourceSchemaTerm(input: {
  sourceSystem: string;
  objectType: string;
  surface: string;
  contextualRole: string;
}): SourceSchemaTerm {
  const normalizedSurface = normalizeSurface(input.surface);
  const identity = {
    sourceSystem: input.sourceSystem,
    objectType: input.objectType,
    normalizedSurface,
    contextualRole: input.contextualRole,
  };
  return {
    id: stableId("source_term", identity),
    ...input,
    normalizedSurface,
    canonicalHint:
      contextualHints[
        `${input.sourceSystem}|${input.objectType}|${normalizedSurface}|${input.contextualRole}`
      ] ?? "UNMAPPED",
  };
}

export function naiveFieldNameAlignment(term: SourceSchemaTerm): string {
  if (term.normalizedSurface === "owner") return "OWNS";
  if (term.normalizedSurface === "assignee") return "ASSIGNED_TO";
  if (term.normalizedSurface === "reviewer") return "REVIEWS";
  return term.normalizedSurface.toLocaleUpperCase("en-US");
}
