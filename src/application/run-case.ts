import { buildDossier } from "@/application/build-dossier";
import { getJudgeCase, type JudgeCase } from "@/cases/case-registry";
import { evaluateCoverage } from "@/coverage/evaluate-coverage";
import type {
  GraphClaimEvidence,
  GraphAlignmentDecision,
  GraphConflictDecision,
  GraphIdentityDecision,
  GraphObservationEvidence,
  HydraPathProof,
  HydraRepository,
} from "@/hydra/client";
import type { Claim } from "@/domain/ontology";

export interface GraphProofSummary {
  operation: "algo.SPpaths";
  consistency: "strong";
  queryId: string;
  readEpoch: number | null;
  bookmark: string | null;
  latencyMs: number;
  roundTrips: 1;
  pathLength: number;
  path: string;
  relationshipTypes: string[];
}

export interface CaseWorkspace {
  case: JudgeCase;
  verdict: "SUPPORTED" | "DISPUTED" | "NOT_FOUND" | "UNKNOWN";
  answer: string;
  evidence: Array<{ source: string; quote: string; value?: string }>;
  decision: { status: string; reason: string; policy?: string };
  coverage: { sufficient: boolean; detail: string };
  counterfactual: string;
  traversal: string;
  ablation: { label: string; result: string };
  graphProof: GraphProofSummary;
}

export type CaseRepository = Pick<HydraRepository,
  "findObservationEvidence" | "findConflictDecision" | "findAlignmentDecisions" |
  "findIdentityDecision" | "entityExists" | "findCoverageSlices" |
  "findClaimEvidence" | "findTeamMemberEvidence" | "findNativePaths"
>;

const ids = {
  conflictEntity: "entity_539b64e1d8320189f27e94fd",
  conflict: "conflict_ba37432da763e77f186ba072",
  handshakeEntity: "entity_bbbccb0c3d43286a9836f543",
  handshakeConflict: "conflict_524fe5b1878058507b93dd95",
  toolSignalEntity: "entity_403f2eafa7d443ad6212821d",
  toolSignalConflict: "conflict_2687f02efba6edbe2d92be93",
  fileOwnerTerm: "source_term_390378ec7210fb25b3662ba0",
  opportunityOwnerTerm: "source_term_0354c371ffe861934bed28e6",
  identityDecision: "identity_candidate_decision_cfbaaae570ab4b5c306e83af",
  knowledgeEntity: "entity_90ad19476a96ae677e3c9143",
  knowledgeSource: "source_object_fa63884437348a11c9312fb9",
  actionGenieEntity: "entity_6b6402fb266f1c3207c7963d",
} as const;

function conflictPointers(caseId: string): { entityId: string; conflictId: string } | undefined {
  if (caseId === "streamly-credit-conflict") {
    return { entityId: ids.conflictEntity, conflictId: ids.conflict };
  }
  if (caseId === "handshake-ttl-conflict") {
    return { entityId: ids.handshakeEntity, conflictId: ids.handshakeConflict };
  }
  if (caseId === "tool-signal-disputed") {
    return { entityId: ids.toolSignalEntity, conflictId: ids.toolSignalConflict };
  }
  return undefined;
}

function extractorVersionRank(version: string): number {
  const match = version.match(/(?:^|:)v(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function oneObservationPerClaim(
  observations: GraphObservationEvidence[],
  claimIds: string[],
): GraphObservationEvidence[] {
  return claimIds.map((claimId) => {
    const candidates = observations
      .filter((item) => item.claimLogicalId === claimId)
      .sort(
        (left, right) =>
          extractorVersionRank(right.extractorVersion) - extractorVersionRank(left.extractorVersion) ||
          right.observationLogicalId.localeCompare(left.observationLogicalId),
      );
    const selected = candidates[0];
    if (!selected) throw new Error("Conflict case is not ready in HydraDB");
    return selected;
  });
}

function literalValue(observation: GraphObservationEvidence): string {
  return observation.object.kind === "literal" ? String(observation.object.value) : observation.object.entityId;
}

function validateConflictProof(
  expectedConflictId: string,
  observations: GraphObservationEvidence[],
  decision: GraphConflictDecision,
): void {
  const conflictClaimIds = new Set(decision.claimIds);
  const observationClaimIds = new Set(observations.map((item) => item.claimLogicalId));
  const claimPathsMatch =
    decision.claimIds.length === 2 &&
    conflictClaimIds.size === 2 &&
    Boolean(decision.leftClaimId) &&
    Boolean(decision.rightClaimId) &&
    decision.leftClaimId !== decision.rightClaimId &&
    conflictClaimIds.has(decision.leftClaimId ?? "") &&
    conflictClaimIds.has(decision.rightClaimId ?? "") &&
    observationClaimIds.size === conflictClaimIds.size &&
    [...conflictClaimIds].every((claimId) => observationClaimIds.has(claimId));

  if (decision.conflictId !== expectedConflictId || !claimPathsMatch) {
    throw new Error("Conflict case is not ready in HydraDB");
  }

  if (decision.resolution === "unresolved") {
    if (decision.winningClaimId || decision.policyId) {
      throw new Error("Conflict case is not ready in HydraDB");
    }
    return;
  }

  if (decision.resolution !== "left" && decision.resolution !== "right") {
    throw new Error("Conflict case is not ready in HydraDB");
  }
  const expectedWinner = decision.resolution === "left" ? decision.leftClaimId : decision.rightClaimId;
  if (!decision.policyId || !decision.winningClaimId || decision.winningClaimId !== expectedWinner) {
    throw new Error("Conflict case is not ready in HydraDB");
  }
}

function acceptedMapping(rows: GraphAlignmentDecision[]): GraphAlignmentDecision {
  const decision = rows.find((row) => row.status === "accepted");
  if (!decision) throw new Error("Required accepted alignment decision is missing from HydraDB");
  return decision;
}

function graphProofSummary(proof: HydraPathProof | undefined): GraphProofSummary {
  if (!proof) {
    throw new Error("Required HydraDB native path proof is missing");
  }
  const path = proof.nodes
    .map((node) => node.logicalId ?? (node.labels.join("|") || String(node.id)))
    .join(" → ");
  if (!path || proof.pathLength !== proof.relationships.length) {
    throw new Error("Required HydraDB native path proof is corrupt");
  }
  return {
    operation: proof.operation,
    consistency: proof.consistency,
    queryId: proof.queryId,
    readEpoch: proof.readEpoch,
    bookmark: proof.bookmark,
    latencyMs: proof.latencyMs,
    roundTrips: proof.roundTrips,
    pathLength: proof.pathLength,
    path,
    relationshipTypes: proof.relationships.map((relationship) => relationship.type),
  };
}

async function requireGraphProof(
  repository: CaseRepository,
  input: Parameters<CaseRepository["findNativePaths"]>[0],
): Promise<GraphProofSummary> {
  const paths = await repository.findNativePaths(input);
  if (paths.length !== 1) {
    throw new Error("Required HydraDB native path proof is missing or ambiguous");
  }
  return graphProofSummary(paths[0]);
}

function literalClaimValue(evidence: GraphClaimEvidence): string | undefined {
  return evidence.object.kind === "literal" ? String(evidence.object.value) : undefined;
}

function targetClaimFromEvidence(
  evidence: GraphClaimEvidence,
  subjectEntityId: string,
): Claim {
  if (!evidence.extractionMethod || !evidence.extractorVersion) {
    throw new Error("Target claim is missing extraction provenance in HydraDB");
  }
  return {
    id: evidence.claimLogicalId,
    subjectEntityId,
    predicate: evidence.predicate,
    object: evidence.object,
    sourceObjectId: evidence.sourceLogicalId,
    sourceSystem: evidence.sourceSystem,
    extractionMethod: evidence.extractionMethod,
    extractorVersion: evidence.extractorVersion,
  };
}

export async function runJudgeCase(caseId: string, repository: CaseRepository): Promise<CaseWorkspace> {
  const judgeCase = getJudgeCase(caseId);
  if (!judgeCase) throw new TypeError(`Unknown judge case: ${caseId}`);

  if (judgeCase.kind === "conflict") {
    const pointers = conflictPointers(judgeCase.id);
    if (!pointers) throw new Error("Conflict case is not ready in HydraDB");
    const [observations, decision] = await Promise.all([
      repository.findObservationEvidence(pointers.entityId),
      repository.findConflictDecision(pointers.conflictId),
    ]);
    if (!decision) {
      throw new Error("Conflict case is not ready in HydraDB");
    }
    const consideredClaimIds = new Set(decision.claimIds);
    const scopedObservations = observations.filter((observation) =>
      consideredClaimIds.has(observation.claimLogicalId),
    );
    const conflictObservations = oneObservationPerClaim(scopedObservations, decision.claimIds);
    if (conflictObservations.length < 2) {
      throw new Error("Conflict case is not ready in HydraDB");
    }
    validateConflictProof(pointers.conflictId, conflictObservations, decision);
    if (decision.winningClaimId) {
      const winner = conflictObservations.find((item) => item.claimLogicalId === decision.winningClaimId);
      if (!winner) throw new Error("Winning claim evidence is missing from HydraDB");
      const graphProof = await requireGraphProof(repository, {
        sourceLogicalId: winner.claimLogicalId,
        targetLogicalId: winner.sourceLogicalId,
        relationshipTypes: ["HAS_OBSERVATION", "SUPPORTED_BY"],
        maxLength: 2,
        pathCount: 1,
      });
      return conflictWorkspace(judgeCase, conflictObservations, decision, winner, graphProof);
    }
    if (decision.resolution === "unresolved") {
      const target = conflictObservations[0];
      if (!target) throw new Error("Conflict case is not ready in HydraDB");
      const graphProof = await requireGraphProof(repository, {
        sourceLogicalId: target.claimLogicalId,
        targetLogicalId: target.sourceLogicalId,
        relationshipTypes: ["HAS_OBSERVATION", "SUPPORTED_BY"],
        maxLength: 2,
        pathCount: 1,
      });
      return disputedWorkspace(judgeCase, conflictObservations, decision, graphProof);
    }
    throw new Error("Conflict case is not ready in HydraDB");
  }

  if (judgeCase.kind === "alignment") {
    const [fileRows, opportunityRows] = await Promise.all([
      repository.findAlignmentDecisions(ids.fileOwnerTerm),
      repository.findAlignmentDecisions(ids.opportunityOwnerTerm),
    ]);
    const file = acceptedMapping(fileRows);
    const opportunity = acceptedMapping(opportunityRows);
    if (
      file.ontologyTermName === opportunity.ontologyTermName ||
      file.ontologyTermName !== "FILE_OWNER" ||
      opportunity.ontologyTermName !== "OPPORTUNITY_OWNER"
    ) {
      throw new Error("Alignment case is not ready in HydraDB");
    }
    const graphProof = await requireGraphProof(repository, {
      sourceLogicalId: ids.fileOwnerTerm,
      targetLogicalId: file.ontologyTermId,
      relationshipTypes: ["MAPS_TO"],
      maxLength: 1,
      pathCount: 1,
    });
    return {
      case: judgeCase,
      verdict: "SUPPORTED",
      answer: `No. ${file.ontologyTermName} and ${opportunity.ontologyTermName} are distinct ontology relations.`,
      evidence: [
        { source: "Google Drive · document.owner", quote: `Accepted mapping → ${file.ontologyTermName} (${file.ontologyTermId})` },
        { source: "HubSpot · opportunity.owner", quote: `Accepted mapping → ${opportunity.ontologyTermName} (${opportunity.ontologyTermId})` },
      ],
      decision: { status: "accepted", reason: "Exact source context plus compatible domain and range.", policy: "alignment-registry-v1" },
      coverage: { sufficient: true, detail: "Both source-schema observations were acquired from canonical ERB records." },
      counterfactual: "A versioned registry rule with different compatible domains would change the mapping.",
      traversal: "SourceObject → OBSERVED_AS → SourceSchemaTerm → MAPS_TO → OntologyTerm",
      ablation: { label: "Naive field-name mapping", result: "Both become OWNS, erasing file vs opportunity semantics." },
      graphProof,
    };
  }

  if (judgeCase.kind === "identity") {
    const decision = await repository.findIdentityDecision(ids.identityDecision);
    if (
      !decision ||
      decision.status !== "rejected" ||
      decision.sourceObjectIds.length !== 2 ||
      !decision.signalKinds.includes("name_similarity") ||
      !decision.constraintKinds.includes("employee_id_conflict")
    ) {
      throw new Error("Identity case is not ready in HydraDB");
    }
    const targetSource = decision.sourceObjectIds[0];
    if (!targetSource) throw new Error("Identity case is not ready in HydraDB");
    const graphProof = await requireGraphProof(repository, {
      sourceLogicalId: ids.identityDecision,
      targetLogicalId: targetSource,
      relationshipTypes: ["CONSIDERS"],
      maxLength: 1,
      pathCount: 1,
    });
    return identityWorkspace(judgeCase, decision, graphProof);
  }

  if (judgeCase.kind === "simple_lookup") {
    const [entityExists, roleEvidence] = await Promise.all([
      repository.entityExists(ids.knowledgeEntity),
      repository.findClaimEvidence(ids.knowledgeEntity, "has_role"),
    ]);
    const roleValues = [
      ...new Set(roleEvidence.map(literalClaimValue).filter((value): value is string => Boolean(value))),
    ];
    if (!entityExists || roleEvidence.length === 0 || roleValues.length !== 1) {
      throw new Error("Simple lookup case is not ready in HydraDB");
    }
    const targetEvidence = [...roleEvidence].sort(
      (left, right) =>
        left.claimLogicalId.localeCompare(right.claimLogicalId) ||
        left.sourceLogicalId.localeCompare(right.sourceLogicalId),
    )[0];
    if (!targetEvidence) throw new Error("Simple lookup case is not ready in HydraDB");
    const graphProof = await requireGraphProof(repository, {
      sourceLogicalId: targetEvidence.claimLogicalId,
      targetLogicalId: targetEvidence.sourceLogicalId,
      relationshipTypes: ["SUPPORTED_BY"],
      maxLength: 1,
      pathCount: 1,
    });
    const answer = roleValues[0];
    return {
      case: judgeCase,
      verdict: "SUPPORTED",
      answer,
      evidence: roleEvidence.map((item) => ({
        source: `${item.sourceSystem} · ${item.sourceNativeId}`,
        quote: item.evidenceQuote ?? answer,
        value: literalClaimValue(item),
      })),
      decision: {
        status: "supported",
        reason: "The resolved employee's canonical role claims agree.",
      },
      coverage: {
        sufficient: true,
        detail: "A grounded role claim and its canonical HERB source were retrieved.",
      },
      counterfactual: "A grounded contradictory role claim would open a conflict instead of silently replacing this answer.",
      traversal: "Entity → ASSERTS → Claim → SUPPORTED_BY → SourceObject",
      ablation: {
        label: "No canonical entity",
        result: "A name-only lookup could attach another Charlie Davis record's role.",
      },
      graphProof,
    };
  }

  if (judgeCase.kind === "multi_hop") {
    const [memberRows, slices] = await Promise.all([
      repository.findTeamMemberEvidence(ids.actionGenieEntity),
      repository.findCoverageSlices("herb", "product"),
    ]);
    const membersByEntity = new Map<string, (typeof memberRows)[number]>();
    for (const member of memberRows) {
      const previous = membersByEntity.get(member.entityLogicalId);
      if (previous && previous.displayName !== member.displayName) {
        throw new Error("Multi-hop case has conflicting member identities in HydraDB");
      }
      membersByEntity.set(member.entityLogicalId, previous ?? member);
    }
    const members = [...membersByEntity.values()].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.entityLogicalId.localeCompare(right.entityLogicalId),
    );
    const coverage = evaluateCoverage(
      {
        slices: [
          {
            sourceSystem: "herb",
            objectType: "product",
            predicateFamily: "product_team",
            contentScope: "metadata",
          },
        ],
      },
      slices,
    );
    if (members.length === 0 || !coverage.sufficient) {
      throw new Error("Multi-hop case is not ready in HydraDB");
    }
    const targetSource = members[0]?.sourceLogicalId;
    if (!targetSource) throw new Error("Multi-hop case is not ready in HydraDB");
    const graphProof = await requireGraphProof(repository, {
      sourceLogicalId: ids.actionGenieEntity,
      targetLogicalId: targetSource,
      relationshipTypes: ["HAS_TEAM_MEMBER", "ASSERTS", "SUPPORTED_BY"],
      maxLength: 3,
      pathCount: 1,
    });
    return {
      case: judgeCase,
      verdict: "SUPPORTED",
      answer: `${members.length} team members: ${members.map((member) => member.displayName).join(", ")}.`,
      evidence: members.map((member) => ({
        source: `${member.sourceSystem} · ${member.sourceNativeId}`,
        quote: `${member.displayName} is linked to ActionGenie through HAS_TEAM_MEMBER.`,
        value: member.displayName,
      })),
      decision: {
        status: "supported",
        reason: "Distinct canonical employees were traversed through product membership and grounded name claims.",
      },
      coverage: {
        sufficient: true,
        detail: "The completed HERB product slice covers product_team relationships.",
      },
      counterfactual: "A later complete HERB product ingestion could add or remove a grounded team relationship.",
      traversal: "Product → HAS_TEAM_MEMBER → Employee → ASSERTS → display_name → SUPPORTED_BY → SourceObject",
      ablation: {
        label: "No graph traversal",
        result: "Client-side joins must fan out across product, employee, claim, and source records.",
      },
      graphProof,
    };
  }

  const [entityExists, slices, locationEvidence] = await Promise.all([
    repository.entityExists(ids.knowledgeEntity),
    repository.findCoverageSlices("herb", "employee"),
    judgeCase.id === "charlie-davis-lagos"
      ? repository.findClaimEvidence(ids.knowledgeEntity, "located_in")
      : Promise.resolve([]),
  ]);
  const predicateFamily =
    judgeCase.id === "charlie-davis-lagos" ? "location" : "favorite_lunch";
  const coverage = evaluateCoverage(
    {
      slices: [
        {
          sourceSystem: "herb",
          objectType: "employee",
          predicateFamily,
          contentScope: "metadata",
        },
      ],
    },
    slices,
  );
  const targetEvidence = locationEvidence.filter(
    (item) => literalClaimValue(item)?.trim().toLocaleLowerCase() === "lagos",
  );
  const dossier = buildDossier({
    question: judgeCase.question,
    claims: targetEvidence.map((item) => targetClaimFromEvidence(item, ids.knowledgeEntity)),
    conflicts: [],
    coverage,
    identity: entityExists ? { status: "resolved", entityId: ids.knowledgeEntity } : { status: "missing" },
    sourceLabels: Object.fromEntries(
      targetEvidence.map((item) => [item.sourceLogicalId, `${item.sourceSystem} · ${item.sourceNativeId}`]),
    ),
    completedCoverageSliceIds: slices
      .filter((slice) => slice.status === "complete")
      .map((slice) => slice.id),
  });
  const pathEvidence = locationEvidence[0];
  const graphProof = await requireGraphProof(repository, {
    sourceLogicalId: pathEvidence?.claimLogicalId ?? ids.knowledgeEntity,
    targetLogicalId: pathEvidence?.sourceLogicalId ?? ids.knowledgeSource,
    relationshipTypes: pathEvidence ? ["SUPPORTED_BY"] : ["ASSERTS", "SUPPORTED_BY"],
    maxLength: pathEvidence ? 1 : 2,
    pathCount: 1,
  });
  if (judgeCase.id === "charlie-davis-lagos") {
    const isFound = dossier.verdict === "SUPPORTED";
    return {
      case: judgeCase,
      verdict: dossier.verdict,
      answer: isFound
        ? "Yes. A grounded Lagos location claim was found."
        : dossier.verdict === "NOT_FOUND"
          ? "No Lagos location was found in the completed employee-location coverage."
          : "Not enough evidence to decide whether Charlie Davis is located in Lagos.",
      evidence: [
        ...targetEvidence.map((item) => ({
          source: `${item.sourceSystem} · ${item.sourceNativeId}`,
          quote: item.evidenceQuote ?? "Grounded location evidence: Lagos",
          value: literalClaimValue(item),
        })),
        ...locationEvidence
          .filter((item) => !targetEvidence.includes(item))
          .map((item) => ({
            source: `${item.sourceSystem} · ${item.sourceNativeId}`,
            quote: `Related location evidence: ${literalClaimValue(item) ?? "non-literal location"}`,
            value: literalClaimValue(item),
          })),
      ],
      decision: {
        status: dossier.verdict === "NOT_FOUND" ? "absence_proven" : dossier.verdict.toLowerCase(),
        reason:
          dossier.verdict === "NOT_FOUND"
            ? "Identity is resolved, the location slice is complete, and no Lagos claim exists."
            : "The verdict follows the grounded target claims and explicit location coverage.",
      },
      coverage: {
        sufficient: coverage.sufficient,
        detail: coverage.sufficient
          ? "The completed HERB employee slice covers location metadata."
          : "The HERB employee slice does not prove complete location coverage.",
      },
      counterfactual:
        dossier.counterfactuals[0]?.summary ??
        "A grounded Lagos claim would change the result to SUPPORTED.",
      traversal: "Entity → ASSERTS → located_in Claim → SUPPORTED_BY → SourceObject; IngestionRun → COVERS → employee/location",
      ablation: {
        label: "No coverage gate",
        result: "Without a completed location slice, the same missing Lagos claim must be UNKNOWN rather than NOT_FOUND.",
      },
      graphProof,
    };
  }
  return {
    case: judgeCase,
    verdict: dossier.verdict,
    answer: "Not enough evidence to answer.",
    evidence: [],
    decision: { status: "abstained", reason: "Absence cannot be claimed outside a completed coverage slice." },
    coverage: { sufficient: false, detail: "HERB covers identity, role, employment, and location—not favorite_lunch." },
    counterfactual: dossier.counterfactuals[0]?.summary ?? "Complete preference coverage would make absence decidable.",
    traversal: "IngestionRun → COVERS → CoverageSlice (required family missing)",
    ablation: { label: "No coverage gate", result: "Would incorrectly return NOT_FOUND as if the corpus had been exhaustively checked." },
    graphProof,
  };
}

function conflictWorkspace(
  caseValue: JudgeCase,
  observations: GraphObservationEvidence[],
  decision: GraphConflictDecision,
  winner: GraphObservationEvidence,
  graphProof: GraphProofSummary,
): CaseWorkspace {
  const values = observations.map((item) => literalValue(item));
  return {
    case: caseValue,
    verdict: "SUPPORTED",
    answer: literalValue(winner),
    evidence: observations.map((item) => ({ source: `${item.sourceSystem} · ${item.sourceNativeId}`, quote: item.evidenceQuote, value: literalValue(item) })),
    decision: { status: "resolved", reason: "Applied policy outranks a proposal; the losing claim remains visible.", policy: decision.policyId },
    coverage: { sufficient: true, detail: "Both contradiction-bearing canonical sources were examined." },
    counterfactual: "A later grounded claim that supersedes the applied policy would change the answer.",
    traversal: "Entity → ASSERTS → Claim → HAS_OBSERVATION → SourceObject; Conflict → DECIDED_BY → AuthorityPolicy",
    ablation: { label: "No conflict policy", result: `${values.join(" and ")} remain disputed; no controlling answer can be issued.` },
    graphProof,
  };
}

function disputedWorkspace(
  caseValue: JudgeCase,
  observations: GraphObservationEvidence[],
  decision: GraphConflictDecision,
  graphProof: GraphProofSummary,
): CaseWorkspace {
  const values = observations.map((item) => literalValue(item));
  return {
    case: caseValue,
    verdict: "DISPUTED",
    answer: `Unresolved conflict: ${values.join(" vs ")}.`,
    evidence: observations.map((item) => ({ source: `${item.sourceSystem} · ${item.sourceNativeId}`, quote: item.evidenceQuote, value: literalValue(item) })),
    decision: { status: "unresolved", reason: "The competing claims have no grounded lifecycle or source-authority distinction that can select a winner.", policy: decision.policyId },
    coverage: { sufficient: true, detail: "Both contradiction-bearing canonical sources were examined." },
    counterfactual: "Grounded supersession evidence or a versioned predicate-specific source-authority policy would resolve the conflict.",
    traversal: "Entity → ASSERTS → Claim → HAS_OBSERVATION → SourceObject; Conflict → CONSIDERS → Claim",
    ablation: { label: "Force a winner without a rule", result: `Would hide the ${values.join(" vs ")} disagreement behind a guessed answer.` },
    graphProof,
  };
}

function identityWorkspace(
  caseValue: JudgeCase,
  decision: GraphIdentityDecision,
  graphProof: GraphProofSummary,
): CaseWorkspace {
  return {
    case: caseValue,
    verdict: "SUPPORTED",
    answer: "No. Keep them as two people.",
    evidence: decision.sourceObjectIds.map((source, index) => ({ source: `HERB source ${index + 1}`, quote: source })),
    decision: { status: decision.status, reason: "Exact name similarity is blocked by conflicting verified employee IDs.", policy: "resolver-v2" },
    coverage: { sufficient: true, detail: "Both canonical employee records and their identity keys were examined." },
    counterfactual: "A verified account link plus removal of the employee-ID conflict would permit a merge.",
    traversal: "ResolutionDecision → SUPPORTED_BY → name_similarity; ResolutionDecision → BLOCKED_BY → employee_id_conflict",
    ablation: { label: "Naive fuzzy-name resolver", result: "Merges 1,645 same-name pairs; 1,627 violate known employee-ID constraints." },
    graphProof,
  };
}
