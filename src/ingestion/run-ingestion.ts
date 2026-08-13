import path from "node:path";

import { stableId } from "@/domain/ids";
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

  return {
    adapter: {
      sourceSystem: adapter.sourceSystem,
      objectType: adapter.objectType,
      version: adapter.version,
    },
    records,
    rejected,
    coverage,
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
