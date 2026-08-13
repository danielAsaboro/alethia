import { NextResponse } from "next/server";

import { buildDossier } from "@/application/build-dossier";
import { dossierRequestSchema } from "@/application/dossier-request";
import { evaluateCoverage } from "@/coverage/evaluate-coverage";
import type { Claim } from "@/domain/ontology";
import { HydraRepository } from "@/hydra/client";

export const dynamic = "force-dynamic";

function repository(): HydraRepository {
  return new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
}

export async function POST(request: Request) {
  const parsed = dossierRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const hydra = repository();
  try {
    const [entityExists, graphEvidence, slices] = await Promise.all([
      hydra.entityExists(parsed.data.entityLogicalId),
      hydra.findClaimEvidence(
        parsed.data.entityLogicalId,
        parsed.data.predicate,
      ),
      hydra.findCoverageSlices(
        parsed.data.sourceSystem,
        parsed.data.objectType,
      ),
    ]);
    const claims: Claim[] = graphEvidence.map((evidence) => ({
      id: evidence.claimLogicalId,
      subjectEntityId: parsed.data.entityLogicalId,
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
            sourceSystem: parsed.data.sourceSystem,
            objectType: parsed.data.objectType,
            predicateFamily: parsed.data.predicateFamily,
            contentScope: parsed.data.contentScope,
          },
        ],
      },
      slices,
    );
    const sourceLabels = Object.fromEntries(
      graphEvidence.map((evidence) => [
        evidence.sourceLogicalId,
        `${evidence.sourceSystem} · ${evidence.sourceNativeId}`,
      ]),
    );

    return NextResponse.json(
      buildDossier({
        question: parsed.data.question,
        claims,
        conflicts: [],
        coverage,
        identity: entityExists
          ? { status: "resolved", entityId: parsed.data.entityLogicalId }
          : { status: "missing" },
        sourceLabels,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "hydradb_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  } finally {
    await hydra.close();
  }
}
