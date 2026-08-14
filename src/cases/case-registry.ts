export type JudgeCaseKind = "conflict" | "alignment" | "identity" | "knowledge_boundary";

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
    title: "Leave a conflict open",
    question: "Default TTL for the cross-account GPU warm-pool handoff handshake token?",
    summary: "One source says the default is now 120 seconds. Another still says 180 without lifecycle metadata, so the policy refuses one-sided precedence.",
    dataset: "Enterprise RAG Bench",
    version: "qst_0421-v1",
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
];

export function listJudgeCases(): JudgeCase[] {
  return cases.map((item) => ({ ...item }));
}

export function getJudgeCase(caseId: string): JudgeCase | undefined {
  return listJudgeCases().find((item) => item.id === caseId);
}
