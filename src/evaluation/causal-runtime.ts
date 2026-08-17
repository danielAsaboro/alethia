import { createHash } from "node:crypto";

import type { CausalCaseInput, CausalDocument } from "./causal-arms";

interface SourcePassage { id: string; sourceSystem: string; text: string }

interface FreezeCase {
  caseId: string;
  question: string;
  retrieved: SourcePassage[];
  graph: {
    verdict: CausalCaseInput["graph"]["verdict"];
    currentSourceObjectIds: string[];
    supersededSourceObjectIds: string[];
    conflictSourceObjectIds: string[];
    hydraQueryIds: string[];
  };
}

interface FreezeInput {
  datasetRevision: string;
  seed: string;
  cases: FreezeCase[];
  replacementSources: SourcePassage[];
}

function words(value: string): RegExpMatchArray[] {
  return [...value.matchAll(/\S+/g)];
}

function tokenCount(value: string): number {
  return words(value).length;
}

function prefixTokens(value: string, count: number): string {
  const matches = words(value);
  if (matches.length < count || count < 1) throw new Error("Replacement source is shorter than the required context budget");
  const final = matches[count - 1]!;
  return value.slice(0, final.index! + final[0].length);
}

function replacementFor(
  sources: SourcePassage[],
  excluded: Set<string>,
  count: number,
  seed: string,
): SourcePassage {
  const eligible = sources.filter((source) => !excluded.has(source.id) && tokenCount(source.text) >= count);
  if (eligible.length === 0) throw new Error("No real replacement passage satisfies the matched context budget");
  const index = Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) % eligible.length;
  return eligible[index]!;
}

export function freezeCausalRuntime(input: FreezeInput): {
  schemaVersion: 1;
  labelFree: true;
  datasetRevision: string;
  seed: string;
  cases: CausalCaseInput[];
} {
  if (!input.datasetRevision || !input.seed || input.cases.length === 0) throw new TypeError("Causal runtime metadata is incomplete");
  const cases = input.cases.map((row): CausalCaseInput => {
    if (row.graph.hydraQueryIds.length === 0 || new Set(row.graph.hydraQueryIds).size !== row.graph.hydraQueryIds.length) {
      throw new TypeError(`Case ${row.caseId} requires unique live Hydra query receipts`);
    }
    const retrievedIds = row.retrieved.map((source) => source.id);
    if (retrievedIds.length < 1 || new Set(retrievedIds).size !== retrievedIds.length) throw new TypeError(`Case ${row.caseId} has invalid retrieval candidates`);
    const excluded = new Set(retrievedIds);
    const retrieved: CausalDocument[] = row.retrieved.map((source) => ({
      ...source,
      tokenCount: tokenCount(source.text),
      lifecycle: row.graph.currentSourceObjectIds.includes(source.id)
        ? "current"
        : row.graph.supersededSourceObjectIds.includes(source.id)
          ? "superseded"
          : "unknown",
    }));
    const replacements: CausalDocument[] = retrieved.map((source, index) => {
      const selected = replacementFor(input.replacementSources, excluded, source.tokenCount, `${input.seed}:${row.caseId}:${index}`);
      excluded.add(selected.id);
      const text = prefixTokens(selected.text, source.tokenCount);
      return {
        id: `replacement_${createHash("sha256").update(`${row.caseId}:${selected.id}:${index}:${text}`).digest("hex").slice(0, 24)}`,
        sourceSystem: selected.sourceSystem,
        text,
        tokenCount: source.tokenCount,
        lifecycle: "unknown",
      };
    });
    return {
      caseId: row.caseId,
      question: row.question,
      documents: [...retrieved, ...replacements],
      retrievalDocumentIds: retrievedIds,
      graph: {
        currentDocumentIds: [...row.graph.currentSourceObjectIds],
        supersededDocumentIds: [...row.graph.supersededSourceObjectIds],
        conflictDocumentIds: [...row.graph.conflictSourceObjectIds],
        verdict: row.graph.verdict,
        hydraQueryIds: [...row.graph.hydraQueryIds],
      },
    };
  });
  return { schemaVersion: 1, labelFree: true, datasetRevision: input.datasetRevision, seed: input.seed, cases };
}
