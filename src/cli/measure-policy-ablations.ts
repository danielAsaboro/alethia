import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateCoverage } from "@/coverage/evaluate-coverage";
import type { Claim, CoverageAssessment, EvidenceConflict, VerdictInput } from "@/domain/ontology";
import { evaluateAblationMatrix } from "@/evaluation/ablation-matrix";
import {
  HydraRepository,
  type GraphClaimEvidence,
  type GraphObservationEvidence,
  type NativePathInput,
} from "@/hydra/client";

const ids = {
  conflictEntity: "entity_539b64e1d8320189f27e94fd",
  conflict: "conflict_ba37432da763e77f186ba072",
  identityDecision: "identity_candidate_decision_cfbaaae570ab4b5c306e83af",
  knowledgeEntity: "entity_90ad19476a96ae677e3c9143",
  fileOwnerTerm: "source_term_390378ec7210fb25b3662ba0",
  opportunityOwnerTerm: "source_term_0354c371ffe861934bed28e6",
} as const;

const complete: CoverageAssessment = { sufficient: true, missing: [] };
const usage = "Usage: npm run measure:ablations -- --output <path>";

function extractorRevision(row: GraphObservationEvidence): number {
  const match = row.extractorVersion.match(/:v(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

export function latestObservationsByClaim(
  observations: GraphObservationEvidence[],
  claimIds: string[],
): GraphObservationEvidence[] {
  return [...new Set(claimIds)]
    .map((claimId) =>
      observations
        .filter((row) => row.claimLogicalId === claimId)
        .sort(
          (left, right) =>
            extractorRevision(right) - extractorRevision(left) ||
            right.observationLogicalId.localeCompare(left.observationLogicalId),
        )[0],
    )
    .filter((row): row is GraphObservationEvidence => row !== undefined);
}

function observationClaim(row: GraphObservationEvidence): Claim {
  if (row.method !== "qvac" && row.method !== "deterministic") {
    throw new TypeError("Ablation observation has an unsupported extraction method");
  }
  return {
    id: row.claimLogicalId,
    subjectEntityId: ids.conflictEntity,
    predicate: row.predicate,
    object: row.object,
    sourceObjectId: row.sourceLogicalId,
    sourceSystem: row.sourceSystem,
    extractionMethod: row.method,
    extractorVersion: row.extractorVersion,
  };
}

function evidenceClaim(row: GraphClaimEvidence, subjectEntityId: string): Claim {
  if (!row.extractionMethod || !row.extractorVersion) {
    throw new TypeError("Ablation claim is missing extraction provenance");
  }
  return {
    id: row.claimLogicalId,
    subjectEntityId,
    predicate: row.predicate,
    object: row.object,
    sourceObjectId: row.sourceLogicalId,
    sourceSystem: row.sourceSystem,
    extractionMethod: row.extractionMethod,
    extractorVersion: row.extractorVersion,
  };
}

export function parseMeasureAblationArgs(args: string[]) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
    throw new TypeError(usage);
  }
  return { output: args[1] };
}

export async function measurePolicyAblations(repository: HydraRepository) {
  const [observations, conflictDecision, slices, identityDecision, fileRows, opportunityRows, roleRows] =
    await Promise.all([
      repository.findObservationEvidence(ids.conflictEntity),
      repository.findConflictDecision(ids.conflict),
      repository.findCoverageSlices("herb", "employee"),
      repository.findIdentityDecision(ids.identityDecision),
      repository.findAlignmentDecisions(ids.fileOwnerTerm),
      repository.findAlignmentDecisions(ids.opportunityOwnerTerm),
      repository.findClaimEvidence(ids.knowledgeEntity, "has_role"),
    ]);
  if (!conflictDecision || !identityDecision || roleRows.length === 0) {
    throw new Error("Required real HydraDB ablation inputs are missing");
  }
  const conflictClaims = latestObservationsByClaim(
    observations,
    conflictDecision.claimIds,
  )
    .map(observationClaim);
  if (conflictClaims.length !== 2) throw new Error("Conflict ablation requires two real claims");
  const conflict: EvidenceConflict = {
    id: conflictDecision.conflictId,
    leftClaimId: conflictDecision.leftClaimId ?? "",
    rightClaimId: conflictDecision.rightClaimId ?? "",
    resolution:
      conflictDecision.resolution === "left" || conflictDecision.resolution === "right"
        ? conflictDecision.resolution
        : "unresolved",
    policyId: conflictDecision.policyId,
  };
  if (!conflict.leftClaimId || !conflict.rightClaimId) {
    throw new Error("Conflict ablation endpoints are missing");
  }

  const resolvedSources = await repository.findResolvedEntitiesForSources(
    identityDecision.sourceObjectIds,
  );
  const identityEntityIds = [...new Set(resolvedSources.map((item) => item.entityLogicalId))];
  if (identityEntityIds.length !== 2) {
    throw new Error("Identity ablation requires two distinct real entities");
  }
  const identityClaims = await repository.findClaimEvidence(identityEntityIds[0]!, "display_name");
  const groundedIdentityClaims = (
    identityClaims.length > 0
      ? identityClaims
      : await repository.findClaimEvidence(identityEntityIds[0]!, "has_role")
  ).map((row) => evidenceClaim(row, identityEntityIds[0]!));
  if (groundedIdentityClaims.length === 0) {
    throw new Error("Identity ablation has no grounded real claim");
  }

  const accepted = (rows: typeof fileRows) => {
    const matches = rows.filter((row) => row.status === "accepted");
    if (matches.length !== 1) throw new Error("Alignment ablation requires one accepted mapping");
    return matches[0]!;
  };
  const file = accepted(fileRows);
  const opportunity = accepted(opportunityRows);
  const alignmentClaims: [Claim, Claim] = [
    {
      id: file.decisionId,
      subjectEntityId: "enterprise_alignment_scope",
      predicate: file.ontologyTermName,
      object: { kind: "entity", entityId: file.ontologyTermId },
      sourceObjectId: file.sourceTermId,
      sourceSystem: "google_drive",
      extractionMethod: "deterministic",
      extractorVersion: "alignment-registry-v1",
    },
    {
      id: opportunity.decisionId,
      subjectEntityId: "enterprise_alignment_scope",
      predicate: opportunity.ontologyTermName,
      object: { kind: "entity", entityId: opportunity.ontologyTermId },
      sourceObjectId: opportunity.sourceTermId,
      sourceSystem: "hubspot",
      extractionMethod: "deterministic",
      extractorVersion: "alignment-registry-v1",
    },
  ];
  const role = evidenceClaim(roleRows[0]!, ids.knowledgeEntity);
  const nativePathInput = {
    sourceLogicalId: ids.knowledgeEntity,
    targetLogicalId: role.sourceObjectId,
    relationshipTypes: ["ASSERTS", "SUPPORTED_BY"],
    maxLength: 2,
    pathCount: 1,
  } satisfies NativePathInput;
  const [nativePaths, clientPath] = await Promise.all([
    repository.findNativePaths(nativePathInput),
    repository.findClientPathBaseline(nativePathInput),
  ]);
  const resolvedInput = (claims: Claim[]): VerdictInput => ({
    claims,
    conflicts: [],
    coverage: complete,
    identity: { status: "resolved", entityId: claims[0]?.subjectEntityId ?? ids.knowledgeEntity },
  });
  const coverage = evaluateCoverage({ slices: [{
    sourceSystem: "herb",
    objectType: "employee",
    predicateFamily: "favorite_lunch",
    contentScope: "metadata",
  }] }, slices);
  const outcomes = evaluateAblationMatrix({
    conflict: { ...resolvedInput(conflictClaims), conflicts: [conflict] },
    coverage: { claims: [], conflicts: [], coverage, identity: { status: "resolved", entityId: ids.knowledgeEntity } },
    identity: { claims: groundedIdentityClaims, conflicts: [], coverage: complete, identity: { status: "ambiguous", candidateEntityIds: identityEntityIds } },
    alignment: { left: alignmentClaims[0], right: alignmentClaims[1], verdict: resolvedInput(alignmentClaims) },
    nativePath: {
      verdict: resolvedInput([role]),
      nativeProofPresent: nativePaths.length === 1,
      clientPathFound: clientPath.found,
      nativeRoundTrips: nativePaths[0]?.roundTrips ?? 0,
      clientRoundTrips: clientPath.roundTrips,
    },
  });
  return {
    scope: "executable production-policy ablations over real HydraDB-frozen inputs; graph state unchanged",
    inputProof: {
      conflictId: conflict.id,
      coverageSliceIds: slices.map((slice) => slice.id).sort(),
      identityDecisionId: identityDecision.decisionId,
      identityEntityIds: identityEntityIds.sort(),
      alignmentDecisionIds: alignmentClaims.map((claim) => claim.id).sort(),
      nativePathQueryId: nativePaths[0]!.queryId,
      nativePathTelemetry: repository.pathTelemetry(nativePaths[0]!),
      boundedClientPath: clientPath,
    },
    outcomes,
  };
}

async function main() {
  const options = parseMeasureAblationArgs(process.argv.slice(2));
  const repository = new HydraRepository({
    httpUrl: process.env.HYDRA_HTTP_URL ?? "http://127.0.0.1:8443",
    token: process.env.HYDRA_TOKEN ?? "local-development-token-32-bytes",
    graphId: process.env.HYDRA_GRAPH_ID ?? "default",
    namespace: process.env.HYDRA_NAMESPACE ?? "default",
    cellId: process.env.HYDRA_CELL_ID ?? "cell-0",
  });
  try {
    const report = await measurePolicyAblations(repository);
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await repository.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
