import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateCoverage } from "@/coverage/evaluate-coverage";
import type { Claim, Verdict } from "@/domain/ontology";
import { evaluateCases, evaluatePairs, type EvaluationCase } from "@/evaluation/metrics";
import { HydraRepository } from "@/hydra/client";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import type { IngestionBundle, NormalizedSourceObject } from "@/ingestion/source-adapter";
import { decideVerdict } from "@/verdicts/decide-verdict";

interface EvaluateHerbArgs {
  input: string;
  evidence: string;
}

interface HerbCase {
  id: string;
  entityId: string;
  predicate: string;
  predicateFamily: string;
  objectType: string;
  expectedVerdict: Verdict;
  expectedEvidenceIds: string[];
}

const usage =
  "Usage: npm run evaluate:herb -- --input <path> --evidence <path>";

export function parseEvaluateHerbArgs(args: string[]): EvaluateHerbArgs {
  let input: string | undefined;
  let evidence: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--input" && flag !== "--evidence")) {
      throw new TypeError(usage);
    }
    if (flag === "--input") input = value;
    if (flag === "--evidence") evidence = value;
  }
  if (!input || !evidence) throw new TypeError(usage);
  return { input, evidence };
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("|");
}

function explicitIdentityPairs(records: NormalizedSourceObject[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    for (const identity of record.identities) {
      if (identity.kind !== "external_id") continue;
      const key = `${identity.sourceSystem}:${identity.normalizedValue}`;
      groups.set(key, [...(groups.get(key) ?? []), record.id]);
    }
  }
  const pairs = new Set<string>();
  for (const ids of groups.values()) {
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        pairs.add(pairKey(ids[left], ids[right]));
      }
    }
  }
  return pairs;
}

function buildCases(ingestion: IngestionBundle): HerbCase[] {
  const recordById = new Map(
    ingestion.records.map((record) => [record.id, record]),
  );
  const groups = new Map<string, HerbCase>();
  for (const claim of ingestion.extraction.claims) {
    const record = recordById.get(claim.sourceObjectId);
    if (!record) continue;
    const supported =
      (record.sourceObjectType === "employee" &&
        (claim.predicate === "has_role" || claim.predicate === "located_in")) ||
      (record.sourceObjectType === "customer" && claim.predicate === "has_role");
    if (!supported) continue;
    const predicateFamily = claim.predicate === "located_in" ? "location" : "role";
    const key = `${claim.subjectEntityId}|${claim.predicate}|${record.sourceObjectType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.expectedEvidenceIds.push(claim.id);
    } else {
      groups.set(key, {
        id: key,
        entityId: claim.subjectEntityId,
        predicate: claim.predicate,
        predicateFamily,
        objectType: record.sourceObjectType,
        expectedVerdict: "SUPPORTED",
        expectedEvidenceIds: [claim.id],
      });
    }
  }

  const cases = [...groups.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const employee = ingestion.records.find(
    (record) => record.sourceObjectType === "employee",
  );
  const employeeEntity = employee
    ? ingestion.resolution.entities.find((entity) =>
        entity.sourceObjectIds.includes(employee.id),
      )
    : undefined;
  if (!employeeEntity) throw new Error("HERB employee identity case unavailable");
  cases.push({
    id: `${employeeEntity.id}|favorite_lunch|employee`,
    entityId: employeeEntity.id,
    predicate: "favorite_lunch",
    predicateFamily: "favorite_lunch",
    objectType: "employee",
    expectedVerdict: "UNKNOWN",
    expectedEvidenceIds: [],
  });
  return cases;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        output[index] = await transform(values[index]);
      }
    }),
  );
  return output;
}

async function main(): Promise<void> {
  const options = parseEvaluateHerbArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const ingestion = await runIngestion(new HerbAdapter(), options.input);
  const cases = buildCases(ingestion);
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });

  try {
    const coverageByObjectType = new Map<string, Awaited<ReturnType<typeof repository.findCoverageSlices>>>();
    for (const objectType of new Set(cases.map((item) => item.objectType))) {
      coverageByObjectType.set(
        objectType,
        await repository.findCoverageSlices("herb", objectType),
      );
    }
    const results = await mapConcurrent(cases, 12, async (testCase) => {
      const start = performance.now();
      const graphEvidence = await repository.findClaimEvidence(
        testCase.entityId,
        testCase.predicate,
      );
      const claims: Claim[] = graphEvidence.map((evidence) => ({
        id: evidence.claimLogicalId,
        subjectEntityId: testCase.entityId,
        predicate: evidence.predicate,
        object: evidence.object,
        sourceObjectId: evidence.sourceLogicalId,
        sourceSystem: evidence.sourceSystem,
        extractionMethod: "deterministic",
        extractorVersion: "hydra-graph-v1",
      }));
      const coverage = evaluateCoverage(
        {
          slices: [
            {
              sourceSystem: "herb",
              objectType: testCase.objectType,
              predicateFamily: testCase.predicateFamily,
              contentScope: "metadata",
            },
          ],
        },
        coverageByObjectType.get(testCase.objectType) ?? [],
      );
      const dossier = decideVerdict({
        claims,
        conflicts: [],
        coverage,
        identity: { status: "resolved", entityId: testCase.entityId },
      });
      const result: EvaluationCase = {
        expectedVerdict: testCase.expectedVerdict,
        actualVerdict: dossier.verdict,
        expectedEvidenceIds: testCase.expectedEvidenceIds,
        actualEvidenceIds: dossier.evidenceClaimIds,
        latencyMs: Number((performance.now() - start).toFixed(3)),
      };
      return { id: testCase.id, ...result };
    });

    const goldPairs = explicitIdentityPairs(ingestion.records);
    const predictedPairs = new Set(
      ingestion.resolution.decisions
        .filter((decision) => decision.status === "accepted")
        .map((decision) => pairKey(...decision.candidateSourceObjectIds)),
    );
    const report = evaluateCases(results);
    const unknownResult = results.find((result) =>
      result.id.includes("favorite_lunch"),
    );
    const artifact = {
      startedAt,
      completedAt: new Date().toISOString(),
      dataset: {
        name: "Salesforce HERB",
        license: "CC BY-NC 4.0; research-use limitations apply",
        inputPath: path.resolve(options.input),
        adapterVersion: ingestion.adapter.version,
        records: ingestion.summary.records,
        rejected: ingestion.summary.rejected,
      },
      scope: {
        supportedCases: cases.filter((item) => item.expectedVerdict === "SUPPORTED").length,
        abstentionCases: cases.filter((item) => item.expectedVerdict === "UNKNOWN").length,
        evaluatedPredicates: ["has_role", "located_in", "favorite_lunch"],
        conflictCases: 0,
        conflictLimitation:
          "The downloaded HERB structural slice has no contradictory claim labels; conflict accuracy is not reported.",
      },
      answers: report,
      entityResolution: evaluatePairs(goldPairs, predictedPairs),
      ablations: {
        noEntityResolution: {
          entities: ingestion.records.length,
          fullSystemEntities: ingestion.resolution.entities.length,
          unresolvedDuplicateRecords:
            ingestion.records.length - ingestion.resolution.entities.length,
        },
        noCoverageGate: {
          case: unknownResult?.id,
          expected: "UNKNOWN",
          fullSystem: unknownResult?.actualVerdict,
          naiveNoEvidenceVerdict: "NOT_FOUND",
        },
      },
      failures: results.filter(
        (result) =>
          result.actualVerdict !== result.expectedVerdict ||
          result.actualEvidenceIds.some(
            (id) => !result.expectedEvidenceIds.includes(id),
          ),
      ),
    };
    const evidencePath = path.resolve(options.evidence);
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ evidencePath, ...report, failures: artifact.failures.length }));
    if (report.verdictAccuracy < 1 || artifact.failures.length > 0) process.exitCode = 1;
  } finally {
    await repository.close();
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
