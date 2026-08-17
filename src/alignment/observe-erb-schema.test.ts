import { describe, expect, it } from "vitest";

import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { buildAlignmentAudit } from "./build-audit";
import { observeErbSchema } from "./observe-erb-schema";

describe("observeErbSchema", () => {
  it("observes a balanced, real nine-source alignment corpus without labels", async () => {
    const ingestion = await runIngestion(
      new ErbAdapter(),
      "../resources/EnterpriseRAG-Bench/evidence/alignment-scale.jsonl",
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
