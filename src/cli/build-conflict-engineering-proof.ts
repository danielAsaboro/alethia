import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Claim } from "@/domain/ontology";
import {
  buildConflictEngineeringProof,
  discoverSourceOnlyConflicts,
} from "@/evaluation/conflict-engineering-proof";

interface Args {
  claims: string;
  runtime: string;
  scored: string;
  topK: string[];
  batching: string;
  output: string;
}

const usage = "Usage: npm run proof:conflicts -- --claims <claims.json> --runtime <causal-runtime-results.json> --scored <causal-scored.json> --top-k <runtime.json> (four times) --batching <batching.json> --output <proof.json>";

export function parseBuildConflictEngineeringProofArgs(values: string[]): Args {
  const result: Partial<Args> & { topK: string[] } = { topK: [] };
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index], value = values[index + 1];
    if (!flag || !value) throw new TypeError(usage);
    if (flag === "--top-k") result.topK.push(value);
    else if (flag === "--claims") result.claims = value;
    else if (flag === "--runtime") result.runtime = value;
    else if (flag === "--scored") result.scored = value;
    else if (flag === "--batching") result.batching = value;
    else if (flag === "--output") result.output = value;
    else throw new TypeError(usage);
  }
  if (!result.claims || !result.runtime || !result.scored || !result.batching || !result.output) throw new TypeError(usage);
  if (result.topK.length !== 4) throw new TypeError("Conflict engineering proof requires four --top-k artifacts");
  return result as Args;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const args = parseBuildConflictEngineeringProofArgs(process.argv.slice(2));
  const paths = [args.claims, args.runtime, args.scored, ...args.topK, args.batching].map((value) => path.resolve(value));
  const bytes = await Promise.all(paths.map((value) => readFile(value)));
  const [claimsRaw, runtimeRaw, scoredRaw, ...remaining] = bytes.map((value) => JSON.parse(value.toString("utf8")) as Record<string, unknown>);
  const batchingRaw = remaining.pop() as Record<string, unknown>;
  const topKRaw = remaining as Record<string, unknown>[];
  const claims = claimsRaw.claims;
  const runtimeRows = runtimeRaw.results;
  const report = scoredRaw.report as { arms?: unknown } | undefined;
  if (!Array.isArray(claims) || !Array.isArray(runtimeRows) || !report || typeof report.arms !== "object" || report.arms === null) {
    throw new TypeError("Conflict engineering proof inputs are malformed");
  }
  const summaries = topKRaw.map((artifact) => {
    const summary = artifact.summary as Record<string, unknown> | undefined;
    return {
      topK: Number(artifact.topK),
      totalQuestions: Number(summary?.totalQuestions),
      conflictMatches: Number(summary?.conflictMatches),
      interventions: Number(summary?.interventions),
      unsupportedInterventions: Number(summary?.unsupportedInterventions),
    };
  }).sort((left, right) => left.topK - right.topK);
  if (summaries.map((row) => row.topK).join(",") !== "5,10,20,50" || summaries.some((row) => row.totalQuestions !== 500)) {
    throw new TypeError("Top-k evidence must cover 5, 10, 20, and 50 over all 500 questions");
  }
  const invariant = batchingRaw.invariant as Record<string, unknown> | undefined;
  if (!invariant) throw new TypeError("Batching evidence has no invariant section");
  const proof = buildConflictEngineeringProof({
    sourceOnlyDiscovery: discoverSourceOnlyConflicts(claims as Claim[]),
    scoredArms: report.arms as Parameters<typeof buildConflictEngineeringProof>[0]["scoredArms"],
    runtimeRows: runtimeRows as Parameters<typeof buildConflictEngineeringProof>[0]["runtimeRows"],
    topKSummaries: summaries,
    batching: {
      maximumRoundTripsPerRequest: Number(invariant.maximumRoundTripsPerRequest),
      allQueryIdsUnique: invariant.allQueryIdsUnique === true,
      noLinearPerDocumentQueryGrowth: invariant.noLinearPerDocumentQueryGrowth === true,
    },
  });
  const artifact = {
    ...proof,
    generatedAt: new Date().toISOString(),
    inputs: Object.fromEntries(paths.map((value, index) => [path.basename(value), sha256(bytes[index]!)])),
  };
  const output = path.resolve(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, conflicts: proof.inventoryFreeMechanism.discovery.conflicts.length, topK: summaries.map((row) => row.topK) }));
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
