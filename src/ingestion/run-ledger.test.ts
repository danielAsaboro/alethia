import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mapIngestionToGraph } from "@/hydra/write-bundle";
import { ErbAdapter } from "./erb-adapter";
import { buildIngestionRunLedger } from "./run-ledger";
import { runIngestion } from "./run-ingestion";

describe("buildIngestionRunLedger", () => {
  it("accounts for every raw record and produces stable replay identifiers", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sourcetruce-ledger-"));
    const input = path.join(directory, "records.jsonl");
    const valid = { doc_id: "dsid_abc123", source_type: "slack", title: "Title", content: "Canonical body" };
    await writeFile(input, `${JSON.stringify(valid)}\n${JSON.stringify(valid)}\n{"doc_id":"bad"}\n`, "utf8");
    const bundle = await runIngestion(new ErbAdapter(), input);
    const graph = mapIngestionToGraph(bundle);
    const first = buildIngestionRunLedger([{ dataset: "Enterprise RAG Bench", inputPath: input, bundle, graph }]);
    const replay = buildIngestionRunLedger([{ dataset: "Enterprise RAG Bench", inputPath: input, bundle, graph }]);

    expect(first.counts.accepted + first.counts.rejected + first.counts.skipped + first.counts.failed).toBe(first.recordsAttempted);
    expect(first.counts).toEqual({ accepted: 1, rejected: 1, skipped: 1, failed: 0 });
    expect(first.noise.exactDuplicates).toBe(1);
    expect(replay.mutationIds).toEqual(first.mutationIds);
    expect(replay.graphFingerprint).toEqual(first.graphFingerprint);
  });
});
