import path from "node:path";

import type { ExtractionGap, ReferencedEntity } from "@/claims/claim-extractor";
import { stableId } from "@/domain/ids";
import {
  createExtractionContext,
  DeterministicClaimExtractor,
} from "@/claims/deterministic-extractor";
import type { Claim } from "@/domain/ontology";
import { resolveEntities } from "@/resolution/resolve-entities";
import type {
  IngestionBundle,
  RejectedRecord,
  SourceAdapter,
} from "./source-adapter";

function failureReason(error: unknown): RejectedRecord["reason"] {
  return error instanceof SyntaxError ? "invalid_json" : "unsupported_input";
}

export async function runIngestion(
  adapter: SourceAdapter,
  inputPath: string,
): Promise<IngestionBundle> {
  const absolutePath = path.resolve(inputPath);
  const records: IngestionBundle["records"] = [];
  const rejected: IngestionBundle["rejected"] = [];
  const coverage: IngestionBundle["coverage"] = [];

  try {
    for await (const event of adapter.read(absolutePath)) {
      if (event.type === "record") {
        records.push(event.record);
      } else if (event.type === "rejected") {
        rejected.push(event.rejected);
      } else {
        coverage.push(event.slice);
      }
    }
  } catch (error) {
    const reason = failureReason(error);
    const detail = error instanceof Error ? error.message : String(error);
    const failureKey = {
      sourceSystem: adapter.sourceSystem,
      objectType: adapter.objectType,
      version: adapter.version,
      sourcePath: absolutePath,
      reason,
    };
    rejected.push({
      id: stableId("rejected_record", failureKey),
      sourcePath: absolutePath,
      reason,
      detail,
    });
    coverage.push({
      id: stableId("coverage", failureKey),
      ingestionRunId: stableId("ingestion_run", failureKey),
      sourceSystem: adapter.sourceSystem,
      objectType: adapter.objectType,
      predicateFamilies: [],
      contentScope: "metadata",
      status: "failed",
      failureReason: reason,
    });
  }

  const resolution = resolveEntities(records);
  const extractionContext = createExtractionContext(records, resolution);
  const extractor = new DeterministicClaimExtractor();
  const claims: Claim[] = [];
  const referencedEntityById = new Map<string, ReferencedEntity>();
  const gaps: ExtractionGap[] = [];
  for (const record of records) {
    const result = await extractor.extract(record, extractionContext);
    claims.push(...result.claims);
    gaps.push(...result.gaps);
    for (const entity of result.referencedEntities) {
      referencedEntityById.set(entity.id, entity);
    }
  }

  return {
    adapter: {
      sourceSystem: adapter.sourceSystem,
      objectType: adapter.objectType,
      version: adapter.version,
    },
    records,
    rejected,
    coverage,
    resolution,
    extraction: {
      claims,
      referencedEntities: [...referencedEntityById.values()],
      gaps,
    },
    summary: {
      records: records.length,
      rejected: rejected.length,
      coverageSlices: coverage.length,
      completeCoverageSlices: coverage.filter(
        (slice) => slice.status === "complete",
      ).length,
    },
  };
}
