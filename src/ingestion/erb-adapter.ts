import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { stableId } from "@/domain/ids";
import type { CoverageSlice } from "@/domain/ontology";
import type {
  AdapterEvent,
  NormalizedSourceObject,
  SourceAdapter,
} from "./source-adapter";

interface CanonicalErbDocument {
  doc_id: string;
  source_type: string;
  title: string;
  content: string;
}

const canonicalFields = ["content", "doc_id", "source_type", "title"];

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalErbDocument(value: unknown): value is CanonicalErbDocument {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join("\0") !== canonicalFields.join("\0")
  ) {
    return false;
  }
  return (
    typeof value.doc_id === "string" &&
    /^dsid_[a-f0-9]+$/.test(value.doc_id) &&
    typeof value.source_type === "string" &&
    /^[a-z][a-z0-9_]*$/.test(value.source_type) &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    value.content.length > 0
  );
}

function normalizeDocument(
  document: CanonicalErbDocument,
  sourcePath: string,
): NormalizedSourceObject {
  const payloadDigest = digest(
    JSON.stringify({
      docId: document.doc_id,
      sourceType: document.source_type,
      title: document.title,
      content: document.content,
    }),
  );
  return {
    id: stableId("source_object", {
      dataset: "onyx-dot-app/EnterpriseRAG-Bench",
      split: "test",
      docId: document.doc_id,
      payloadDigest,
    }),
    sourceSystem: document.source_type,
    sourceObjectType: "document",
    sourceNativeId: document.doc_id,
    sourcePath,
    contentScope: "body",
    payloadDigest,
    fields: {
      dataset: "onyx-dot-app/EnterpriseRAG-Bench",
      docId: document.doc_id,
      title: document.title,
      body: document.content,
      contentDigest: digest(document.content),
    },
    identities: [
      {
        kind: "external_id",
        value: document.doc_id,
        normalizedValue: document.doc_id,
        sourceSystem: document.source_type,
      },
    ],
  };
}

function coverageSlice(input: {
  inputDigest: string;
  sourceSystem: string;
  rejectedCount: number;
}): CoverageSlice {
  const runKey = {
    adapter: "erb-canonical-v1",
    collection: "focused-conflict-evidence",
    inputDigest: input.inputDigest,
  };
  const ingestionRunId = stableId("ingestion_run", runKey);
  return {
    id: stableId("coverage", {
      ingestionRunId,
      sourceSystem: input.sourceSystem,
      objectType: "document",
    }),
    ingestionRunId,
    sourceSystem: input.sourceSystem,
    objectType: "document",
    predicateFamilies: ["enterprise_evidence"],
    contentScope: "body",
    status: input.rejectedCount === 0 ? "complete" : "partial",
    failureReason:
      input.rejectedCount === 0
        ? undefined
        : `${input.rejectedCount} invalid canonical records`,
  };
}

export class ErbAdapter implements SourceAdapter {
  readonly sourceSystem = "enterprise_rag_bench";
  readonly objectType = "document";
  readonly version = "erb-canonical-v1";

  async *read(inputPath: string): AsyncIterable<AdapterEvent> {
    const absolutePath = path.resolve(inputPath);
    const body = await readFile(absolutePath, "utf8");
    const inputDigest = digest(body);
    const sourceSystems = new Set<string>();
    let rejectedCount = 0;

    for (const [index, line] of body.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const sourcePath = `${absolutePath}#L${index + 1}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", {
              inputDigest,
              line: index + 1,
              reason: "invalid_json",
            }),
            sourcePath,
            reason: "invalid_json",
            detail: "ERB evidence row is not valid JSON",
          },
        };
        continue;
      }
      if (!isCanonicalErbDocument(parsed)) {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", {
              inputDigest,
              line: index + 1,
              reason: "invalid_shape",
            }),
            sourcePath,
            sourceNativeId:
              isRecord(parsed) && typeof parsed.doc_id === "string"
                ? parsed.doc_id
                : undefined,
            reason: "invalid_shape",
            detail:
              "ERB evidence row must contain only doc_id, source_type, title, and non-empty content",
          },
        };
        continue;
      }
      sourceSystems.add(parsed.source_type);
      yield {
        type: "record",
        record: normalizeDocument(parsed, sourcePath),
      };
    }

    for (const sourceSystem of [...sourceSystems].sort()) {
      yield {
        type: "coverage",
        slice: coverageSlice({ inputDigest, sourceSystem, rejectedCount }),
      };
    }
  }
}
