import { buildDossier } from "@/application/build-dossier";
import { getJudgeCase, type JudgeCase } from "@/cases/case-registry";
import { evaluateCoverage } from "@/coverage/evaluate-coverage";
import type {
  GraphAlignmentDecision,
  GraphConflictDecision,
  GraphIdentityDecision,
  GraphObservationEvidence,
  HydraRepository,
} from "@/hydra/client";

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
}

export type CaseRepository = Pick<HydraRepository,
  "findObservationEvidence" | "findConflictDecision" | "findAlignmentDecisions" |
  "findIdentityDecision" | "entityExists" | "findCoverageSlices"
>;

const ids = {
  conflictEntity: "entity_539b64e1d8320189f27e94fd",
  conflict: "conflict_ba37432da763e77f186ba072",
  handshakeEntity: "entity_bbbccb0c3d43286a9836f543",
  handshakeConflict: "conflict_f83ddaaaa1d7e8f3623f4e8b",
  fileOwnerTerm: "source_term_390378ec7210fb25b3662ba0",
  opportunityOwnerTerm: "source_term_0354c371ffe861934bed28e6",
  identityDecision: "identity_candidate_decision_cfbaaae570ab4b5c306e83af",
  knowledgeEntity: "entity_90ad19476a96ae677e3c9143",
} as const;

function conflictPointers(caseId: string): { entityId: string; conflictId: string } | undefined {
  if (caseId === "streamly-credit-conflict") {
    return { entityId: ids.conflictEntity, conflictId: ids.conflict };
  }
  if (caseId === "handshake-ttl-conflict") {
    return { entityId: ids.handshakeEntity, conflictId: ids.handshakeConflict };
  }
  return undefined;
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
    const conflictObservations = observations.filter((observation) =>
      consideredClaimIds.has(observation.claimLogicalId),
    );
    if (conflictObservations.length < 2) {
      throw new Error("Conflict case is not ready in HydraDB");
    }
    validateConflictProof(pointers.conflictId, conflictObservations, decision);
    if (decision.winningClaimId) {
      const winner = conflictObservations.find((item) => item.claimLogicalId === decision.winningClaimId);
      if (!winner) throw new Error("Winning claim evidence is missing from HydraDB");
      return conflictWorkspace(judgeCase, conflictObservations, decision, winner);
    }
    if (decision.resolution === "unresolved") {
      return disputedWorkspace(judgeCase, conflictObservations, decision);
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
    return identityWorkspace(judgeCase, decision);
  }

  const [entityExists, slices] = await Promise.all([
    repository.entityExists(ids.knowledgeEntity),
    repository.findCoverageSlices("herb", "employee"),
  ]);
  const coverage = evaluateCoverage({ slices: [{ sourceSystem: "herb", objectType: "employee", predicateFamily: "favorite_lunch", contentScope: "metadata" }] }, slices);
  const dossier = buildDossier({
    question: judgeCase.question,
    claims: [], conflicts: [], coverage,
    identity: entityExists ? { status: "resolved", entityId: ids.knowledgeEntity } : { status: "missing" },
    sourceLabels: {},
  });
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
  };
}

function conflictWorkspace(caseValue: JudgeCase, observations: GraphObservationEvidence[], decision: GraphConflictDecision, winner: GraphObservationEvidence): CaseWorkspace {
  return {
    case: caseValue,
    verdict: "SUPPORTED",
    answer: literalValue(winner),
    evidence: observations.map((item) => ({ source: `${item.sourceSystem} · ${item.sourceNativeId}`, quote: item.evidenceQuote, value: literalValue(item) })),
    decision: { status: "resolved", reason: "Applied policy outranks a proposal; the losing claim remains visible.", policy: decision.policyId },
    coverage: { sufficient: true, detail: "Both contradiction-bearing canonical sources were examined." },
    counterfactual: "A later grounded claim that supersedes the applied policy would change the answer.",
    traversal: "Entity → ASSERTS → Claim → HAS_OBSERVATION → SourceObject; Conflict → DECIDED_BY → AuthorityPolicy",
    ablation: { label: "No conflict policy", result: "20% and 30% remain disputed; no controlling answer can be issued." },
  };
}

function disputedWorkspace(caseValue: JudgeCase, observations: GraphObservationEvidence[], decision: GraphConflictDecision): CaseWorkspace {
  const values = observations.map((item) => literalValue(item));
  return {
    case: caseValue,
    verdict: "DISPUTED",
    answer: `Unresolved conflict: ${values.join(" vs ")}.`,
    evidence: observations.map((item) => ({ source: `${item.sourceSystem} · ${item.sourceNativeId}`, quote: item.evidenceQuote, value: literalValue(item) })),
    decision: { status: "unresolved", reason: "Only one competing claim has a grounded lifecycle; the policy refuses to infer precedence from one-sided metadata.", policy: decision.policyId },
    coverage: { sufficient: true, detail: "Both contradiction-bearing canonical sources were examined." },
    counterfactual: "Grounded lifecycle evidence for the second claim would let the policy compare both sides.",
    traversal: "Entity → ASSERTS → Claim → HAS_OBSERVATION → SourceObject; Conflict → CONSIDERS → Claim",
    ablation: { label: "Force a winner without a rule", result: "Would hide the 120s vs 180s disagreement behind a guessed default." },
  };
}

function identityWorkspace(caseValue: JudgeCase, decision: GraphIdentityDecision): CaseWorkspace {
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
  };
}
