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

  it("resolves the real HERB employee and team views with auditable decisions", async () => {
    const result = await runIngestion(
      new HerbAdapter(),
      path.resolve(process.cwd(), "../resources/HERB"),
    );

    expect(result.resolution.entities).toHaveLength(680);
    expect(
      result.resolution.decisions.filter((decision) => decision.status === "accepted"),
    ).toHaveLength(18);
    expect(result.resolution.decisions).toContainEqual(
      expect.objectContaining({
        status: "accepted",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "external_id_exact",
            normalizedValue: "eid_9b023657",
          }),
        ]),
        constraints: ["same_identity_namespace"],
      }),
    );
  });

  it("extracts the complete deterministic structural claim lane", async () => {
    const result = await runIngestion(
      new HerbAdapter(),
      path.resolve(process.cwd(), "../resources/HERB"),
    );

    expect(result.extraction.claims).toHaveLength(5130);
    expect(result.extraction.gaps).toEqual([]);
    expect(
      result.extraction.claims.filter(
        (claim) => claim.predicate === "has_team_member",
      ),
    ).toHaveLength(1370);
    expect(
      result.extraction.claims.filter(
        (claim) => claim.predicate === "serves_customer",
      ),
    ).toHaveLength(720);
    expect(
      result.extraction.claims.filter((claim) => claim.predicate === "manages"),
    ).toHaveLength(512);
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
