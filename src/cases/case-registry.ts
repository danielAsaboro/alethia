export type JudgeCaseKind =
  | "conflict"
  | "alignment"
  | "identity"
  | "knowledge_boundary"
  | "simple_lookup"
  | "multi_hop";

export interface JudgeCase {
  id: string;
  kind: JudgeCaseKind;
  title: string;
  question: string;
  summary: string;
  dataset: string;
  version: string;
}

const cases: JudgeCase[] = [
  {
    id: "streamly-credit-conflict",
    kind: "conflict",
    title: "Resolve a conflict",
    question: "What percentage of Streamly AI's burst credits is actually reserved for priority routes?",
    summary: "A Jira proposal says 20%. An applied Drive policy says 30%.",
    dataset: "Enterprise RAG Bench",
    version: "qst_0411-v1",
  },
  {
    id: "handshake-ttl-conflict",
    kind: "conflict",
    title: "Supersede stale guidance",
    question: "Default TTL for the cross-account GPU warm-pool handoff handshake token?",
    summary: "Updated replay-risk guidance sets 120 seconds and explicitly supersedes the older 180-second default.",
    dataset: "Enterprise RAG Bench",
    version: "qst_0421-v2",
  },
  {
    id: "owner-is-not-owner",
    kind: "alignment",
    title: "Disambiguate “owner”",
    question: "Does Google Drive owner mean the same relationship as HubSpot opportunity owner?",
    summary: "Field-name matching collapses both to OWNS. Context and domain constraints do not.",
    dataset: "Enterprise RAG Bench",
    version: "alignment-registry-v1",
  },
  {
    id: "david-taylor-collision",
    kind: "identity",
    title: "Decide who this person is",
    question: "Should these two David Taylor records be merged into one employee?",
    summary: "The names match exactly; the verified employee IDs conflict.",
    dataset: "Salesforce HERB",
    version: "resolver-v2",
  },
  {
    id: "favorite-lunch-boundary",
    kind: "knowledge_boundary",
    title: "Admit uncertainty",
    question: "What is this employee's favorite lunch?",
    summary: "The graph has complete role data, but no coverage for personal preferences.",
    dataset: "Salesforce HERB",
    version: "coverage-v1",
  },
  {
    id: "charlie-davis-role",
    kind: "simple_lookup",
    title: "Retrieve a canonical fact",
    question: "What is Charlie Davis's role?",
    summary: "Resolve the employee, retrieve the role claim, and preserve its source evidence.",
    dataset: "Salesforce HERB",
    version: "herb-role-v1",
  },
  {
    id: "actiongenie-team",
    kind: "multi_hop",
    title: "Traverse a product team",
    question: "Who works on the ActionGenie product team?",
    summary: "Traverse product membership, each canonical employee, their name claim, and source evidence.",
    dataset: "Salesforce HERB",
    version: "herb-team-v1",
  },
  {
    id: "charlie-davis-lagos",
    kind: "knowledge_boundary",
    title: "Prove a fact is not found",
    question: "Is Charlie Davis located in Lagos?",
    summary: "Complete employee-location coverage makes the missing Lagos claim decidable while retaining the related Remote evidence.",
    dataset: "Salesforce HERB",
    version: "coverage-v1",
  },
];

export function listJudgeCases(): JudgeCase[] {
  return cases.map((item) => ({ ...item }));
}

export function getJudgeCase(caseId: string): JudgeCase | undefined {
  return listJudgeCases().find((item) => item.id === caseId);
}
