import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ErbAdapter } from "./erb-adapter";

const evidencePath = path.resolve(
  process.cwd(),
  "../resources/EnterpriseRAG-Bench/evidence/conflicts.jsonl",
);

async function readRecords() {
  const events = [];
  for await (const event of new ErbAdapter().read(evidencePath)) {
    events.push(event);
  }
  return events.filter((event) => event.type === "record");
}

describe("ErbAdapter", () => {
  it("normalizes the real versioned conflict evidence without label leakage", async () => {
    const raw = await readFile(evidencePath, "utf8");
    expect(raw).not.toMatch(/gold_answer|answer_facts|expected_doc_ids/);

    const records = await readRecords();
    const nativeIds = new Set(
      records.map((event) => event.record.sourceNativeId),
    );
    expect(nativeIds).toHaveLength(39);
    expect(records.length).toBeGreaterThanOrEqual(40);
    expect(
      new Set(records.map((event) => event.record.sourceSystem)).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      records.filter(
        (event) =>
          event.record.sourceNativeId ===
          "dsid_6df52fdb96ae4edcb76464738bca3340",
      ),
    ).toHaveLength(2);
    expect(
      records.every(
        (event) =>
          typeof event.record.fields.body === "string" &&
          event.record.fields.body.length > 0,
      ),
    ).toBe(true);

    const repeated = await readRecords();
    expect(repeated.map((event) => event.record.id)).toEqual(
      records.map((event) => event.record.id),
    );
  });
});
