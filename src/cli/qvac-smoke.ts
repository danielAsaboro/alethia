import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HydraRepository } from "@/hydra/client";
import { HerbAdapter } from "@/ingestion/herb-adapter";
import { runIngestion } from "@/ingestion/run-ingestion";
import { mapQvacClaimToGraph, QvacClient } from "@/qvac/client";

interface QvacSmokeArgs {
  input: string;
  evidence: string;
}

const usage =
  "Usage: npm run qvac:smoke -- --input <path> --evidence <path>";

export function parseQvacSmokeArgs(args: string[]): QvacSmokeArgs {
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

async function main(): Promise<void> {
  const options = parseQvacSmokeArgs(process.argv.slice(2));
  const ingestion = await runIngestion(new HerbAdapter(), options.input);
  const source = ingestion.records.find(
    (record) =>
      record.sourceObjectType === "employee" &&
      record.sourceNativeId === "eid_01942cf0",
  );
  if (!source) throw new Error("Verified HERB employee was not ingested");
  const entity = ingestion.resolution.entities.find((candidate) =>
    candidate.sourceObjectIds.includes(source.id),
  );
  if (!entity) throw new Error("Verified HERB employee was not resolved");
  const name = String(source.fields.name);
  const role = String(source.fields.role);
  const location = String(source.fields.location);
  const sourceText = `${name} works as ${role}. Location: ${location}.`;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = await new QvacClient().extractClaims({
    subjectEntityId: entity.id,
    sourceObjectId: source.id,
    sourceSystem: source.sourceSystem,
    sourceText,
    predicates: [
      { predicate: "has_role", description: "The employee role" },
      { predicate: "located_in", description: "The employee location" },
    ],
  });
  const latencyMs = Number((performance.now() - start).toFixed(3));
  const roleClaim = result.claims.find(
    (claim) =>
      claim.predicate === "has_role" &&
      claim.object.kind === "literal" &&
      claim.object.value === role,
  );
  if (!roleClaim) {
    throw new Error("QVAC did not reproduce the verified HERB role claim");
  }
  const evidenceQuote = result.evidenceQuotes[roleClaim.id];
  if (!evidenceQuote) throw new Error("QVAC role claim has no evidence quote");
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });

  try {
    const prerequisites = await repository.getPresence({
      nodes: [
        { logicalId: entity.id, label: "Entity", properties: {} },
        { logicalId: source.id, label: "SourceObject", properties: {} },
      ],
      edges: [],
    });
    if (prerequisites.nodes !== 2) {
      throw new Error("HydraDB source graph is missing; run hydra:smoke first");
    }
    const qvacGraph = mapQvacClaimToGraph(roleClaim, evidenceQuote);
    await repository.writeGraph(qvacGraph);
    const graphPresence = await repository.getPresence(qvacGraph);
    const graphEvidence = await repository.findClaimEvidence(
      entity.id,
      roleClaim.predicate,
    );
    const persistedEvidence = graphEvidence.find(
      (item) => item.claimLogicalId === roleClaim.id,
    );
    if (
      graphPresence.nodes !== 1 ||
      graphPresence.edges !== 2 ||
      persistedEvidence?.sourceLogicalId !== source.id
    ) {
      throw new Error("QVAC claim did not complete its HydraDB round trip");
    }

    const artifact = {
      startedAt,
      completedAt: new Date().toISOString(),
      runtime: {
        implementation: "QVAC by Tether",
        cliVersion: "0.11.0",
        sdkVersion: "0.17.1",
        provider: "@qvac/ai-sdk-provider",
        providerVersion: "0.6.0",
        aiSdkVersion: "7.0.68",
        transport: "QVAC Vercel AI SDK provider over local loopback HTTP",
        baseUrl: process.env.QVAC_BASE_URL ?? "http://127.0.0.1:11436/v1",
        model: result.model,
        modelConstant: "QWEN3_600M_INST_Q4",
      },
      source: {
        dataset: "Salesforce HERB",
        inputPath: path.resolve(options.input),
        sourceObjectId: source.id,
        nativeId: source.sourceNativeId,
        canonicalEntityId: entity.id,
        sourceText,
      },
      result: {
        latencyMs,
        claims: result.claims,
        evidenceQuotes: result.evidenceQuotes,
        grounded: Object.values(result.evidenceQuotes).every((quote) =>
          sourceText.includes(quote),
        ),
        verifiedRole: role,
        hydraRoundTrip: {
          persisted: true,
          graphPresence,
          evidence: persistedEvidence,
        },
      },
    };
    const evidencePath = path.resolve(options.evidence);
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );
    console.log(
      JSON.stringify({
        evidencePath,
        provider: artifact.runtime.provider,
        model: result.model,
        claims: result.claims.length,
        grounded: artifact.result.grounded,
        roleVerified: true,
        hydraPersisted: true,
        latencyMs,
      }),
    );
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
