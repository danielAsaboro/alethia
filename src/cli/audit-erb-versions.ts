import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HydraRepository } from "@/hydra/client";
import { mapEvidenceSystemToGraph } from "@/hydra/evidence-graph";
import { ErbAdapter } from "@/ingestion/erb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { auditSourceVersions } from "@/noise/audit-source-versions";

interface Args { input: string; manifest: string; output: string }

export function parseAuditErbVersionsArgs(args: string[]): Args {
  const values: Partial<Args> = {};
  const flags: Record<string, keyof Args> = {
    "--input": "input",
    "--manifest": "manifest",
    "--output": "output",
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = flags[args[index]];
    const value = args[index + 1];
    if (!key || !value) {
      throw new TypeError("Usage: npm run audit:erb-versions -- --input <jsonl> --manifest <json> --output <json>");
    }
    values[key] = value;
  }
  if (!values.input || !values.manifest || !values.output) {
    throw new TypeError("Usage: npm run audit:erb-versions -- --input <jsonl> --manifest <json> --output <json>");
  }
  return values as Args;
}

function repository(): HydraRepository {
  return new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

async function main(): Promise<void> {
  const options = parseAuditErbVersionsArgs(process.argv.slice(2));
  const [ingestion, manifestRaw] = await Promise.all([
    runIngestion(new ErbAdapter(), options.input),
    readFile(path.resolve(options.manifest), "utf8"),
  ]);
  if (ingestion.rejected.length > 0) {
    throw new Error("Canonical ERB version input contains rejected records");
  }
  const manifest = JSON.parse(manifestRaw) as {
    datasetUrl: string;
    outputSha256: string;
    divergentVersionCounts: Record<string, number>;
  };
  const audit = auditSourceVersions(ingestion.records);
  const expected = Object.entries(manifest.divergentVersionCounts)
    .filter(([, count]) => count > 1)
    .map(([nativeId]) => nativeId)
    .sort();
  const actual = audit.groups.map((group) => group.sourceNativeId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Version audit disagrees with acquisition manifest: expected ${expected.join(",")}, got ${actual.join(",")}`);
  }

  const graph = mapEvidenceSystemToGraph({
    claims: [], observations: [], conflicts: [], policies: [],
    sources: ingestion.records.map((record) => ({
      id: record.id,
      sourceSystem: record.sourceSystem,
      sourceNativeId: record.sourceNativeId,
      payloadDigest: record.payloadDigest,
    })),
    sourceRelations: audit.relations,
  });
  const hydra = repository();
  try {
    await hydra.writeGraph(graph);
    await hydra.writeGraph(graph);
    const presence = await hydra.getPresence(graph);
    const traversals = Object.fromEntries(await Promise.all(
      audit.groups.map(async (group) => [
        `${group.sourceSystem}:${group.sourceNativeId}`,
        await hydra.findSourceVersionRelations(group.sourceSystem, group.sourceNativeId),
      ] as const),
    ));
    if (presence.nodes !== graph.nodes.length || presence.edges !== graph.edges.length) {
      throw new Error("HydraDB source-version round trip is incomplete");
    }
    if (Object.values(traversals).some((relations) => relations.length === 0)) {
      throw new Error("HydraDB VERSION_OF traversal is incomplete");
    }

    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dataset: {
        url: manifest.datasetUrl,
        inputSha256: manifest.outputSha256,
        records: ingestion.records.length,
      },
      semantics: "VERSION_OF groups divergent payloads with the same source-qualified native ID. Direction uses a deterministic digest anchor because acquisition chronology is unavailable; it does not claim which text is newer.",
      groups: audit.groups,
      relations: audit.relations,
      hydra: {
        implementation: "HydraDB OSS 0.1.0",
        idempotentWriteCount: 2,
        presence,
        traversals,
      },
    };
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output, groups: audit.groups.length, relations: audit.relations.length, presence }));
  } finally {
    await hydra.close();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
