import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { buildAlignmentAudit } from "./build-audit";
import { observeErbSchema } from "./observe-erb-schema";

const alignmentPath = path.resolve(process.cwd(), "../resources/EnterpriseRAG-Bench/evidence/alignment-scale.jsonl");

describe.runIf(existsSync(alignmentPath))("observeErbSchema against the canonical ERB corpus", () => {
  it("observes a balanced, real nine-source alignment corpus without labels", async () => {
    const ingestion = await runIngestion(
      new ErbAdapter(),
      alignmentPath,
    );
    const observations = observeErbSchema(ingestion.records);
    const audit = buildAlignmentAudit(ingestion.records, observations);

    expect(new Set(ingestion.records.map((record) => record.sourceSystem))).toHaveLength(9);
    expect(audit.sourceTerms).toHaveLength(57);
    expect(audit.decisions.filter((decision) => decision.status === "accepted")).toHaveLength(54);
    expect(audit.decisions.filter((decision) => decision.status === "rejected")).toHaveLength(54);
    expect(audit.decisions.filter((decision) => decision.status === "pending")).toHaveLength(3);
    expect(observations.every((observation) => observation.questionId.startsWith("schema:"))).toBe(true);
  });
});
