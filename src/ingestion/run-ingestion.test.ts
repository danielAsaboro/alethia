import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HerbAdapter } from "./herb-adapter";
import { runIngestion } from "./run-ingestion";

const employeesPath = path.resolve(
  process.cwd(),
  "../resources/HERB/data/metadata/employee.json",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runIngestion", () => {
  it("produces identical logical IDs when real HERB input is re-read", async () => {
    const first = await runIngestion(new HerbAdapter(), employeesPath);
    const second = await runIngestion(new HerbAdapter(), employeesPath);

    expect(second.records.map((record) => record.id)).toEqual(
      first.records.map((record) => record.id),
    );
    expect(second.coverage.map((slice) => slice.id)).toEqual(
      first.coverage.map((slice) => slice.id),
    );
    expect(first.summary).toEqual({
      records: 530,
      rejected: 0,
      coverageSlices: 1,
      completeCoverageSlices: 1,
    });
  });

  it("records invalid JSON as failed coverage instead of success", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sourcetruce-herb-"));
    temporaryDirectories.push(directory);
    const invalidPath = path.join(directory, "employee.json");
    await writeFile(invalidPath, "{not valid json", "utf8");

    const result = await runIngestion(new HerbAdapter(), invalidPath);

    expect(result.records).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      sourcePath: invalidPath,
      reason: "invalid_json",
    });
    expect(result.coverage).toHaveLength(1);
    expect(result.coverage[0]).toMatchObject({
      sourceSystem: "herb",
      objectType: "employee",
      predicateFamilies: [],
      contentScope: "metadata",
      status: "failed",
      failureReason: "invalid_json",
    });
    expect(result.summary.completeCoverageSlices).toBe(0);
  });
});
