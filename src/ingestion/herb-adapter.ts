import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { stableId } from "@/domain/ids";
import type { CoverageSlice } from "@/domain/ontology";
import type {
  AdapterEvent,
  IdentityObservation,
  JsonValue,
  NormalizedSourceObject,
  SourceAdapter,
} from "./source-adapter";

interface HerbEmployee {
  employee_id: string;
  name: string;
  role: string;
  location: string;
  org: string;
}

interface HerbCustomer {
  id: string;
  name: string;
  role: string;
  company: string;
}

type JsonRecord = Record<string, JsonValue>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasStrings(
  value: unknown,
  keys: string[],
): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return keys.every(
    (key) => typeof value[key] === "string" && value[key].length > 0,
  );
}

function isHerbEmployee(value: unknown): value is HerbEmployee {
  return hasStrings(value, ["employee_id", "name", "role", "location", "org"]);
}

function isHerbCustomer(value: unknown): value is HerbCustomer {
  return hasStrings(value, ["id", "name", "role", "company"]);
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createSourceObject(input: {
  objectType: string;
  nativeId: string;
  sourcePath: string;
  raw: unknown;
  fields: JsonRecord;
  identities: IdentityObservation[];
}): NormalizedSourceObject {
  const payloadDigest = digest(JSON.stringify(input.raw));
  return {
    id: stableId("source_object", {
      sourceSystem: "herb",
      sourceObjectType: input.objectType,
      sourceNativeId: input.nativeId,
      payloadDigest,
    }),
    sourceSystem: "herb",
    sourceObjectType: input.objectType,
    sourceNativeId: input.nativeId,
    sourcePath: input.sourcePath,
    contentScope: "metadata",
    payloadDigest,
    fields: input.fields,
    identities: input.identities,
  };
}

function externalAndNameIdentities(
  id: string,
  name: string,
  externalIdNamespace: string,
): IdentityObservation[] {
  return [
    {
      kind: "external_id",
      value: id,
      normalizedValue: normalizeText(id),
      sourceSystem: externalIdNamespace,
    },
    {
      kind: "name",
      value: name,
      normalizedValue: normalizeText(name),
      sourceSystem: "herb",
    },
  ];
}

function normalizeEmployee(
  employee: HerbEmployee,
  sourcePath: string,
): NormalizedSourceObject {
  return createSourceObject({
    objectType: "employee",
    nativeId: employee.employee_id,
    sourcePath,
    raw: employee,
    fields: {
      employeeId: employee.employee_id,
      name: employee.name,
      role: employee.role,
      location: employee.location,
      organization: employee.org,
    },
    identities: externalAndNameIdentities(employee.employee_id, employee.name, "herb:person"),
  });
}

function coverageSlice(input: {
  runKey: unknown;
  objectType: string;
  predicateFamilies: string[];
  rejectedCount: number;
}): CoverageSlice {
  const ingestionRunId = stableId("ingestion_run", input.runKey);
  return {
    id: stableId("coverage", {
      ingestionRunId,
      sourceSystem: "herb",
      objectType: input.objectType,
    }),
    ingestionRunId,
    sourceSystem: "herb",
    objectType: input.objectType,
    predicateFamilies: input.predicateFamilies,
    contentScope: "metadata",
    status: input.rejectedCount === 0 ? "complete" : "partial",
    failureReason:
      input.rejectedCount === 0
        ? undefined
        : `${input.rejectedCount} invalid records`,
  };
}

function collectNestedEmployeeIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectNestedEmployeeIds(item, ids);
  } else if (isRecord(value)) {
    if (typeof value.employee_id === "string") ids.add(value.employee_id);
    for (const item of Object.values(value)) collectNestedEmployeeIds(item, ids);
  }
  return ids;
}

function collectMessageAuthorCounts(value: unknown, counts = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) {
    for (const item of value) collectMessageAuthorCounts(item, counts);
  } else if (isRecord(value)) {
    if (typeof value.userId === "string" && value.userId.trim()) {
      const handle = normalizeText(value.userId);
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
    }
    for (const item of Object.values(value)) collectMessageAuthorCounts(item, counts);
  }
  return counts;
}

export function extractProductMessageAuthors(input: {
  productName: string;
  sourcePath: string;
  product: unknown;
}): NormalizedSourceObject[] {
  return [...collectMessageAuthorCounts(input.product)]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([authorHandle, messageCount]) => createSourceObject({
      objectType: "message_author",
      nativeId: `${input.productName}:author:${authorHandle}`,
      sourcePath: input.sourcePath,
      raw: { productName: input.productName, authorHandle, messageCount },
      fields: { name: authorHandle, productName: input.productName, authorHandle, messageCount },
      identities: [
        ...(/^eid_[a-f0-9]+$/u.test(authorHandle) ? [{
          kind: "external_id" as const,
          value: authorHandle,
          normalizedValue: authorHandle,
          sourceSystem: "herb:person",
        }] : []),
        {
          kind: "handle" as const,
          value: authorHandle,
          normalizedValue: authorHandle,
          sourceSystem: "herb:slack",
        },
      ],
    }));
}

async function readJson(filePath: string): Promise<{ body: string; parsed: unknown }> {
  const body = await readFile(filePath, "utf8");
  return { body, parsed: JSON.parse(body) as unknown };
}

export class HerbAdapter implements SourceAdapter {
  readonly sourceSystem = "herb";
  readonly objectType = "employee";
  readonly version = "herb-structural-v2";

  private async *readEmployees(filePath: string): AsyncIterable<AdapterEvent> {
    const { body, parsed } = await readJson(filePath);
    if (!isRecord(parsed)) {
      throw new TypeError("HERB employee metadata must be an object keyed by ID");
    }

    const runKey = { adapter: this.version, objectType: "employee", inputDigest: digest(body) };
    const ingestionRunId = stableId("ingestion_run", runKey);
    let rejectedCount = 0;
    for (const [nativeId, value] of Object.entries(parsed).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!isHerbEmployee(value) || value.employee_id !== nativeId) {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", { ingestionRunId, nativeId, reason: "invalid_shape" }),
            sourcePath: filePath,
            sourceNativeId: nativeId,
            reason: "invalid_shape",
            detail: "Employee record is missing required fields or key does not match employee_id",
          },
        };
      } else {
        yield { type: "record", record: normalizeEmployee(value, filePath) };
      }
    }
    yield {
      type: "coverage",
      slice: coverageSlice({
        runKey,
        objectType: "employee",
        predicateFamilies: ["identity", "employment", "role", "location"],
        rejectedCount,
      }),
    };
  }

  private async *readCustomers(filePath: string): AsyncIterable<AdapterEvent> {
    const { body, parsed } = await readJson(filePath);
    if (!Array.isArray(parsed)) throw new TypeError("HERB customers must be an array");
    const runKey = { adapter: this.version, objectType: "customer", inputDigest: digest(body) };
    let rejectedCount = 0;
    for (const [index, value] of parsed.entries()) {
      if (!isHerbCustomer(value)) {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", { runKey, index, reason: "invalid_shape" }),
            sourcePath: filePath,
            reason: "invalid_shape",
            detail: `Customer at index ${index} is missing required fields`,
          },
        };
      } else {
        yield {
          type: "record",
          record: createSourceObject({
            objectType: "customer",
            nativeId: value.id,
            sourcePath: filePath,
            raw: value,
            fields: { customerId: value.id, name: value.name, role: value.role, company: value.company },
            identities: externalAndNameIdentities(value.id, value.name, "herb:customer"),
          }),
        };
      }
    }
    yield {
      type: "coverage",
      slice: coverageSlice({
        runKey,
        objectType: "customer",
        predicateFamilies: ["identity", "customer_company", "role"],
        rejectedCount,
      }),
    };
  }

  private async *readTeamStructures(filePath: string): AsyncIterable<AdapterEvent> {
    const { body, parsed } = await readJson(filePath);
    if (!Array.isArray(parsed)) throw new TypeError("HERB Salesforce team must be an array");
    const runKey = { adapter: this.version, objectType: "team_structure", inputDigest: digest(body) };
    let rejectedCount = 0;
    for (const [index, value] of parsed.entries()) {
      if (!hasStrings(value, ["employee_id", "name", "role", "location"])) {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", { runKey, index, reason: "invalid_shape" }),
            sourcePath: filePath,
            reason: "invalid_shape",
            detail: `Team structure at index ${index} is missing required fields`,
          },
        };
        continue;
      }
      const reportIds = [...collectNestedEmployeeIds(value)]
        .filter((id) => id !== value.employee_id)
        .sort();
      yield {
        type: "record",
        record: createSourceObject({
          objectType: "team_structure",
          nativeId: value.employee_id,
          sourcePath: filePath,
          raw: value,
          fields: {
            employeeId: value.employee_id,
            name: value.name,
            role: value.role,
            location: value.location,
            directAndNestedReportIds: reportIds,
          },
          identities: externalAndNameIdentities(value.employee_id, value.name, "herb:person"),
        }),
      };
    }
    yield {
      type: "coverage",
      slice: coverageSlice({
        runKey,
        objectType: "team_structure",
        predicateFamilies: ["identity", "employment", "reporting_structure"],
        rejectedCount,
      }),
    };
  }

  private async *readProducts(directory: string): AsyncIterable<AdapterEvent> {
    const filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith(".json"))
      .sort();
    const digests: string[] = [];
    let rejectedCount = 0;
    for (const filename of filenames) {
      const filePath = path.join(directory, filename);
      const { body, parsed } = await readJson(filePath);
      digests.push(digest(body));
      if (!isRecord(parsed)) {
        rejectedCount += 1;
        yield {
          type: "rejected",
          rejected: {
            id: stableId("rejected_record", { filePath, reason: "invalid_shape" }),
            sourcePath: filePath,
            reason: "invalid_shape",
            detail: "Product file must contain a JSON object",
          },
        };
        continue;
      }
      const productName = path.basename(filename, ".json");
      const teamIds = Array.isArray(parsed.team)
        ? parsed.team.filter((item): item is string => typeof item === "string")
        : [];
      const customerIds = Array.isArray(parsed.customers)
        ? parsed.customers.filter((item): item is string => typeof item === "string")
        : [];
      const artifactCounts = Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, (value as unknown[]).length]),
      ) as Record<string, number>;
      yield {
        type: "record",
        record: createSourceObject({
          objectType: "product",
          nativeId: productName,
          sourcePath: filePath,
          raw: parsed,
          fields: { productName, teamIds, customerIds, artifactCounts },
          identities: externalAndNameIdentities(productName, productName, "herb:product"),
        }),
      };
      for (const author of extractProductMessageAuthors({ productName, sourcePath: filePath, product: parsed })) {
        yield { type: "record", record: author };
      }
    }
    const runKey = { adapter: this.version, objectType: "product", inputDigests: digests };
    yield {
      type: "coverage",
      slice: coverageSlice({
        runKey,
        objectType: "product",
        predicateFamilies: ["identity", "message_authorship", "product_team", "product_customer", "source_inventory"],
        rejectedCount,
      }),
    };
  }

  async *read(inputPath: string): AsyncIterable<AdapterEvent> {
    const absolutePath = path.resolve(inputPath);
    if (!(await stat(absolutePath)).isDirectory()) {
      yield* this.readEmployees(absolutePath);
      return;
    }

    yield* this.readEmployees(path.join(absolutePath, "data/metadata/employee.json"));
    yield* this.readCustomers(path.join(absolutePath, "data/metadata/customers_data.json"));
    yield* this.readTeamStructures(path.join(absolutePath, "data/metadata/salesforce_team.json"));
    yield* this.readProducts(path.join(absolutePath, "data/products"));
  }
}
