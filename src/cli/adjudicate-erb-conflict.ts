import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildDossier } from "@/application/build-dossier";
import {
  isAcceptedConflictExtraction,
  promoteAcceptedConflict,
  type PromotedConflict,
} from "@/conflicts/promote-erb-conflict";
import { HydraRepository } from "@/hydra/client";
import { mapEvidenceSystemToGraph } from "@/hydra/evidence-graph";

interface AdjudicateErbConflictArgs {
  extractions: string;
  output: string;
}

const usage =
  "Usage: npm run adjudicate:erb-conflict -- --extractions <path> --output <path>";

export function parseAdjudicateErbConflictArgs(
  args: string[],
): AdjudicateErbConflictArgs {
  let extractions: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || (flag !== "--extractions" && flag !== "--output")) {
      throw new TypeError(usage);
    }
    if (flag === "--extractions") extractions = value;
    if (flag === "--output") output = value;
  }
  if (!extractions || !output) throw new TypeError(usage);
  return { extractions, output };
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

function graphForPromotion(promoted: Exclude<PromotedConflict, { status: "skipped" }>) {
  return mapEvidenceSystemToGraph({
    claims: promoted.claims,
    observations: promoted.observations,
    sources: promoted.accepted.map((extraction) => ({
      id: extraction.sourceObjectId,
      sourceSystem: extraction.sourceSystem,
      sourceNativeId: extraction.sourceNativeId,
      payloadDigest: extraction.sourceDigest,
    })),
    conflicts: [promoted.conflict],
    policies: [
      {
        id: promoted.policy.id,
        predicate: promoted.policy.predicate,
        sourceSystem: "enterprise",
        priority: 100,
        rationale: "Grounded applied or approved state supersedes a proposal",
      },
    ],
  });
}

async function main(): Promise<void> {
  const options = parseAdjudicateErbConflictArgs(process.argv.slice(2));
  const extractionArtifact = JSON.parse(
    await readFile(path.resolve(options.extractions), "utf8"),
  ) as {
    runtime: Record<string, unknown>;
    cases: Array<{
      questionId: string;
      question: string;
      extractions: unknown[];
    }>;
  };
  const promotions = extractionArtifact.cases.map((item) =>
    promoteAcceptedConflict({
      questionId: item.questionId,
      question: item.question,
      accepted: item.extractions.filter(isAcceptedConflictExtraction),
    }),
  );
  const flagship = promotions.find(
    (item) => item.status !== "skipped" && item.questionId === "qst_0411",
  );
  if (!flagship || flagship.status === "skipped") {
    throw new Error("qst_0411 extraction case is missing");
  }
  if (flagship.status !== "resolved" || flagship.winningValue !== "30%") {
    throw new Error("qst_0411 did not resolve to the applied 30% claim");
  }
  const hydra = repository();
  try {
    const written = [];
    for (const promoted of promotions) {
      if (promoted.status === "skipped") continue;
      const graph = graphForPromotion(promoted);
      await hydra.writeGraph(graph);
      await hydra.writeGraph(graph);
      const [presence, observationEvidence, conflictDecision] = await Promise.all([
        hydra.getPresence(graph),
        hydra.findObservationEvidence(promoted.subjectEntityId),
        hydra.findConflictDecision(promoted.conflict.id),
      ]);
      if (
        presence.nodes !== graph.nodes.length ||
        presence.edges !== graph.edges.length ||
        observationEvidence.length < 2 ||
        !conflictDecision
      ) {
        throw new Error(`${promoted.questionId} HydraDB round trip is incomplete`);
      }
      if (promoted.status === "resolved" && conflictDecision.policyId !== promoted.policy.id) {
        throw new Error(`${promoted.questionId} is missing the lifecycle policy path`);
      }
      written.push({
        questionId: promoted.questionId,
        status: promoted.status,
        entityId: promoted.subjectEntityId,
        conflictId: promoted.conflict.id,
        winningValue: promoted.winningValue ?? null,
        presence,
      });
    }
    const sourceLabels = Object.fromEntries(
      flagship.accepted.map((extraction) => [
        extraction.sourceObjectId,
        `${extraction.sourceSystem} · ${extraction.sourceNativeId}`,
      ]),
    );
    const dossier = buildDossier({
      question: flagship.question,
      claims: flagship.claims,
      observations: flagship.observations,
      conflicts: [flagship.conflict],
      coverage: { sufficient: true, missing: [] },
      identity: { status: "resolved", entityId: flagship.subjectEntityId },
      sourceLabels,
      applicablePolicyIds: [flagship.policy.id],
    });
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      caseId: flagship.questionId,
      extractionRuntime: extractionArtifact.runtime,
      dossier,
      promotions: promotions.map((item) =>
        item.status === "skipped"
          ? { questionId: item.questionId, status: item.status, reason: item.reason }
          : {
              questionId: item.questionId,
              status: item.status,
              entityId: item.subjectEntityId,
              conflictId: item.conflict.id,
              winningValue: item.winningValue ?? null,
            },
      ),
      hydra: {
        implementation: "HydraDB OSS 0.1.0",
        written,
      },
    };
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify({
        outputPath,
        verdict: dossier.verdict,
        promoted: written.length,
        unresolved: written.filter((item) => item.status === "unresolved").length,
        hydraPresence: written[0]?.presence,
      }),
    );
  } finally {
    await hydra.close();
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
