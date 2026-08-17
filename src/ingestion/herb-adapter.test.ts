import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HerbAdapter } from "./herb-adapter";

const employeesPath = path.resolve(
  process.cwd(),
  "../resources/HERB/data/metadata/employee.json",
);
const herbRoot = path.resolve(process.cwd(), "../resources/HERB");

describe.runIf(existsSync(herbRoot))("HerbAdapter against the canonical HERB corpus", () => {
  it("normalizes every employee from the real HERB metadata file", async () => {
    const events = [];
    for await (const event of new HerbAdapter().read(employeesPath)) {
      events.push(event);
    }

    const records = events.filter((event) => event.type === "record");
    const coverage = events.filter((event) => event.type === "coverage");
    const rejected = events.filter((event) => event.type === "rejected");

    expect(records).toHaveLength(530);
    expect(rejected).toHaveLength(0);
    expect(coverage).toHaveLength(1);
    expect(coverage[0]).toMatchObject({
      slice: {
        sourceSystem: "herb",
        objectType: "employee",
        contentScope: "metadata",
        status: "complete",
        predicateFamilies: ["identity", "employment", "role", "location"],
      },
    });

    const first = records.find(
      (event) =>
        event.type === "record" &&
        event.record.sourceNativeId === "eid_01942cf0",
    );
    expect(first).toMatchObject({
      type: "record",
      record: {
        sourceSystem: "herb",
        sourceObjectType: "employee",
        sourceNativeId: "eid_01942cf0",
        contentScope: "metadata",
        fields: {
          employeeId: "eid_01942cf0",
          name: "Charlie Davis",
          role: "Software Engineer",
          location: "Remote",
          organization: "salesforce",
        },
        identities: [
          {
            kind: "external_id",
            value: "eid_01942cf0",
            normalizedValue: "eid_01942cf0",
            sourceSystem: "herb:person",
          },
          {
            kind: "name",
            value: "Charlie Davis",
            normalizedValue: "charlie davis",
            sourceSystem: "herb",
          },
        ],
      },
    });

    if (!first || first.type !== "record") {
      throw new Error("Expected real HERB employee record");
    }
    expect(first.record.id).toMatch(/^source_object_[a-f0-9]{24}$/);
    expect(first.record.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("discovers the real HERB structural corpus from its root", async () => {
    const events = [];
    for await (const event of new HerbAdapter().read(herbRoot)) {
      events.push(event);
    }

    const records = events.filter((event) => event.type === "record");
    const coverage = events.filter((event) => event.type === "coverage");
    expect(records).toHaveLength(698);
    expect(coverage).toHaveLength(4);
    expect(coverage.every((event) => event.slice.status === "complete")).toBe(
      true,
    );

    const counts = records.reduce<Record<string, number>>((result, event) => {
      result[event.record.sourceObjectType] =
        (result[event.record.sourceObjectType] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({
      customer: 120,
      employee: 530,
      product: 30,
      team_structure: 18,
    });
    expect(
      records.some(
        (event) =>
          event.record.sourceObjectType === "product" &&
          event.record.sourceNativeId === "ActionGenie",
      ),
    ).toBe(true);
    const customer = records.find((event) => event.record.sourceObjectType === "customer");
    const team = records.find((event) => event.record.sourceObjectType === "team_structure");
    expect(customer?.record.identities.find((identity) => identity.kind === "external_id")?.sourceSystem).toBe("herb:customer");
    expect(team?.record.identities.find((identity) => identity.kind === "external_id")?.sourceSystem).toBe("herb:person");
  });
});
