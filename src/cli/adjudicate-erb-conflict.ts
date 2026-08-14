import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildDossier } from "@/application/build-dossier";
import { consolidateClaims } from "@/claims/consolidate-claims";
import {
  adjudicateConflict,
  type AdjudicationClaim,
  type AdjudicationPolicy,
} from "@/conflicts/adjudicate-conflict";
import { classifyClaimPair } from "@/conflicts/classify-conflicts";
import type { ClaimObservation } from "@/domain/evidence";
import { stableId } from "@/domain/ids";
import type { EvidenceConflict } from "@/domain/ontology";
import { HydraRepository } from "@/hydra/client";
import { mapEvidenceSystemToGraph } from "@/hydra/evidence-graph";

interface AdjudicateErbConflictArgs {
  extractions: string;
  output: string;
}

interface AcceptedExtraction {
  cacheKey: string;
  status: "accepted";
  sourceObjectId: string;
  sourceNativeId: string;
  sourceSystem: string;
  sourceDigest: string;
  observation: {
    subject: string;
    predicate: string;
    value: string | number | boolean;
    evidenceQuote: string;
    lifecycle: AdjudicationClaim["lifecycle"];
  };
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
  const realCase = extractionArtifact.cases.find(
    (candidate) => candidate.questionId === "qst_0411",
  );
  if (!realCase) throw new Error("qst_0411 extraction case is missing");
  const accepted = realCase.extractions.filter(
    (extraction): extraction is AcceptedExtraction => {
      if (
        extraction === null ||
        typeof extraction !== "object" ||
        Array.isArray(extraction)
      ) {
        return false;
      }
      const row = extraction as Record<string, unknown>;
      return row.status === "accepted" && row.observation !== undefined;
    },
  );
  if (accepted.length !== 2) {
    throw new Error(`qst_0411 requires two accepted observations, got ${accepted.length}`);
  }

  const subjectEntityId = stableId("entity", {
    kind: "infrastructure_pool",
    name: accepted[0].observation.subject,
  });
  const observations: ClaimObservation[] = accepted.map((extraction) => ({
    id: stableId("observation", {
      cacheKey: extraction.cacheKey,
      promptVersion: "conflict-observation-v7",
    }),
    claimCandidate: {
      id: `candidate_${extraction.cacheKey}`,
      subjectEntityId,
      predicate: "conflict_answer",
      object: { kind: "literal", value: extraction.observation.value },
      sourceObjectId: extraction.sourceObjectId,
      sourceSystem: extraction.sourceSystem,
      extractionMethod: "qvac",
      extractorVersion: "qvac:sourcetruce-extractor:v7",
    },
    evidenceQuote: extraction.observation.evidenceQuote,
    method: "qvac",
    extractorVersion: "qvac:sourcetruce-extractor:v7",
  }));
  const consolidated = consolidateClaims(observations);
  const adjudicationClaims = accepted.map((extraction): AdjudicationClaim => {
    const observation = consolidated.observations.find(
      (candidate) =>
        candidate.claimCandidate.sourceObjectId === extraction.sourceObjectId,
    );
    if (!observation) throw new Error("Consolidated observation is missing");
    return {
      claim: observation.claimCandidate,
      lifecycle: extraction.observation.lifecycle,
      lifecycleGrounded: true,
    };
  });
  const applied = adjudicationClaims.find(
    (candidate) => candidate.lifecycle === "applied",
  );
  const proposal = adjudicationClaims.find(
    (candidate) => candidate.lifecycle === "proposal",
  );
  if (!applied || !proposal) {
    throw new Error("qst_0411 applied/proposal lifecycle pair is missing");
  }
  const classification = classifyClaimPair(applied.claim, proposal.claim);
  if (classification.kind !== "contradiction") {
    throw new Error(`Expected contradiction, got ${classification.kind}`);
  }
  const conflictId = stableId("conflict", {
    questionId: realCase.questionId,
    leftClaimId: applied.claim.id,
    rightClaimId: proposal.claim.id,
  });
  const policy: AdjudicationPolicy = {
    id: "policy_lifecycle_precedence_v1",
    kind: "lifecycle_precedence",
    predicate: "conflict_answer",
    order: ["deprecated", "proposal", "approved", "applied"],
  };
  const adjudication = adjudicateConflict(
    { id: conflictId, left: applied, right: proposal },
    [policy],
  );
  if (
    adjudication.status !== "resolved" ||
    adjudication.winningClaimId !== applied.claim.id
  ) {
    throw new Error("qst_0411 did not resolve to the applied claim");
  }
  const conflict: EvidenceConflict = {
    id: conflictId,
    leftClaimId: applied.claim.id,
    rightClaimId: proposal.claim.id,
    resolution: "left",
    policyId: policy.id,
  };
  const graph = mapEvidenceSystemToGraph({
    claims: consolidated.claims,
    observations: consolidated.observations,
    sources: accepted.map((extraction) => ({
      id: extraction.sourceObjectId,
      sourceSystem: extraction.sourceSystem,
      sourceNativeId: extraction.sourceNativeId,
      payloadDigest: extraction.sourceDigest,
    })),
    conflicts: [conflict],
    policies: [
      {
        id: policy.id,
        predicate: policy.predicate,
        sourceSystem: "enterprise",
        priority: 100,
        rationale: "Grounded applied state supersedes a grounded proposal",
      },
    ],
  });
  const hydra = repository();
  try {
    await hydra.writeGraph(graph);
    await hydra.writeGraph(graph);
    const [presence, observationEvidence, conflictDecision] = await Promise.all([
      hydra.getPresence(graph),
      hydra.findObservationEvidence(subjectEntityId),
      hydra.findConflictDecision(conflictId),
    ]);
    if (
      presence.nodes !== graph.nodes.length ||
      presence.edges !== graph.edges.length ||
      observationEvidence.length !== 2 ||
      conflictDecision?.policyId !== policy.id
    ) {
      throw new Error("qst_0411 HydraDB round trip is incomplete");
    }
    const sourceLabels = Object.fromEntries(
      accepted.map((extraction) => [
        extraction.sourceObjectId,
        `${extraction.sourceSystem} · ${extraction.sourceNativeId}`,
      ]),
    );
    const dossier = buildDossier({
      question: realCase.question,
      claims: consolidated.claims,
      observations: consolidated.observations,
      conflicts: [conflict],
      coverage: { sufficient: true, missing: [] },
      identity: { status: "resolved", entityId: subjectEntityId },
      sourceLabels,
      applicablePolicyIds: [policy.id],
    });
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      caseId: realCase.questionId,
      extractionRuntime: extractionArtifact.runtime,
      classification,
      adjudication,
      dossier,
      hydra: {
        implementation: "HydraDB OSS 0.1.0",
        traversal:
          "Entity->ASSERTS->Claim->HAS_OBSERVATION->ExtractionObservation->SUPPORTED_BY->SourceObject; Conflict->DECIDED_BY->AuthorityPolicy",
        idempotentWriteCount: 2,
        presence,
        observationEvidence,
        conflictDecision,
      },
    };
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify({
        outputPath,
        verdict: dossier.verdict,
        answer: dossier.answerGroups.map((group) => group.valueLabel),
        losingClaimIds: adjudication.losingClaimIds,
        policyId: adjudication.policyId,
        hydraPresence: presence,
        observationPaths: observationEvidence.length,
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
