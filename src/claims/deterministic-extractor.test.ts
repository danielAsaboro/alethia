import path from "node:path";

import { describe, expect, it } from "vitest";

import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import {
  createExtractionContext,
  DeterministicClaimExtractor,
} from "./deterministic-extractor";

const herbRoot = path.resolve(process.cwd(), "../resources/HERB");

describe("DeterministicClaimExtractor", () => {
  it("extracts provenance-bearing structural claims from a real HERB employee", async () => {
    const bundle = await runIngestion(new HerbAdapter(), herbRoot);
    const record = bundle.records.find(
      (item) =>
        item.sourceObjectType === "employee" &&
        item.sourceNativeId === "eid_01942cf0",
    );
    if (!record) throw new Error("Real HERB employee was not ingested");

    const result = await new DeterministicClaimExtractor().extract(
      record,
      createExtractionContext(bundle.records, bundle.resolution),
    );

    expect(result.gaps).toEqual([]);
    expect(result.claims.map((claim) => claim.predicate).sort()).toEqual([
      "display_name",
      "has_role",
      "located_in",
      "member_of",
    ]);
    expect(result.claims).toContainEqual(
      expect.objectContaining({
        predicate: "has_role",
        object: { kind: "literal", value: "Software Engineer" },
        sourceObjectId: record.id,
        sourceSystem: "herb",
        extractionMethod: "deterministic",
        extractorVersion: "herb-structural-v1",
      }),
    );
    expect(result.claims.find((claim) => claim.predicate === "member_of")?.object)
      .toMatchObject({ kind: "entity" });
    expect(result.claims.every((claim) => /^claim_[a-f0-9]{24}$/.test(claim.id)))
      .toBe(true);
  });

  it("links a real HERB product to resolved employee and customer entities", async () => {
    const bundle = await runIngestion(new HerbAdapter(), herbRoot);
    const record = bundle.records.find(
      (item) =>
        item.sourceObjectType === "product" &&
        item.sourceNativeId === "ActionGenie",
    );
    if (!record) throw new Error("Real HERB product was not ingested");

    const result = await new DeterministicClaimExtractor().extract(
      record,
      createExtractionContext(bundle.records, bundle.resolution),
    );
    const teamClaims = result.claims.filter(
      (claim) => claim.predicate === "has_team_member",
    );
    const customerClaims = result.claims.filter(
      (claim) => claim.predicate === "serves_customer",
    );

    expect(teamClaims.length).toBeGreaterThan(50);
    expect(customerClaims.length).toBeGreaterThan(20);
    expect(
      [...teamClaims, ...customerClaims].every(
        (claim) => claim.object.kind === "entity",
      ),
    ).toBe(true);
    expect(result.gaps).toEqual([]);
  });
});
