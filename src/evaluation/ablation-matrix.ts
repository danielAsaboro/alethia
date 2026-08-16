import { classifyClaimPair } from "@/conflicts/classify-conflicts";
import type { Claim, Verdict, VerdictInput } from "@/domain/ontology";
import { decideVerdict } from "@/verdicts/decide-verdict";

export type AblationId =
  | "no_conflict_policy"
  | "no_coverage_gate"
  | "no_identity_blockers"
  | "naive_field_alignment"
  | "no_graph_traversal";

export interface AblationOutcome {
  id: AblationId;
  baselineVerdict: Verdict;
  ablatedVerdict: Verdict;
  explanation: string;
  baselineRoundTrips?: number;
  ablatedRoundTrips?: number;
}

export interface AblationInputs {
  conflict: VerdictInput;
  coverage: VerdictInput;
  identity: VerdictInput;
  alignment: { left: Claim; right: Claim; verdict: VerdictInput };
  nativePath: {
    verdict: VerdictInput;
    nativeProofPresent: boolean;
    clientPathFound: boolean;
    nativeRoundTrips: number;
    clientRoundTrips: number;
  };
}

export function evaluateAblationMatrix(input: AblationInputs): AblationOutcome[] {
  if (!input.nativePath.nativeProofPresent) {
    throw new TypeError("A real native path proof is required for the baseline");
  }
  const conflictBaseline = decideVerdict(input.conflict).verdict;
  const conflictAblated = decideVerdict({
    ...input.conflict,
    conflicts: input.conflict.conflicts.map((conflict) => ({
      ...conflict,
      resolution: "unresolved" as const,
      policyId: undefined,
    })),
  }).verdict;

  const coverageBaseline = decideVerdict(input.coverage).verdict;
  const coverageAblated = decideVerdict({
    ...input.coverage,
    coverage: { sufficient: true, missing: [] },
  }).verdict;

  const identityBaseline = decideVerdict(input.identity).verdict;
  const assumedEntityId =
    input.identity.identity.status === "ambiguous"
      ? input.identity.identity.candidateEntityIds[0]
      : input.identity.claims[0]?.subjectEntityId;
  const identityAblated = decideVerdict({
    ...input.identity,
    identity: assumedEntityId
      ? { status: "resolved", entityId: assumedEntityId }
      : { status: "missing" },
  }).verdict;

  const alignmentBaseline = decideVerdict(input.alignment.verdict).verdict;
  const naiveClassification = classifyClaimPair(
    input.alignment.left,
    input.alignment.right,
    { predicatesAligned: true },
  );
  const alignmentAblated = decideVerdict({
    ...input.alignment.verdict,
    conflicts:
      naiveClassification.kind === "contradiction"
        ? [
            ...input.alignment.verdict.conflicts,
            {
              id: "ablation-naive-field-alignment",
              leftClaimId: input.alignment.left.id,
              rightClaimId: input.alignment.right.id,
              resolution: "unresolved" as const,
            },
          ]
        : input.alignment.verdict.conflicts,
  }).verdict;

  const nativeBaseline = decideVerdict(input.nativePath.verdict).verdict;
  const nativeAblated = input.nativePath.clientPathFound
    ? decideVerdict(input.nativePath.verdict).verdict
    : decideVerdict({ ...input.nativePath.verdict, identity: { status: "missing" } }).verdict;

  return [
    {
      id: "no_conflict_policy",
      baselineVerdict: conflictBaseline,
      ablatedVerdict: conflictAblated,
      explanation:
        "Removing the stored controlling policy turns resolved contradictory claims back into an explicit dispute.",
    },
    {
      id: "no_coverage_gate",
      baselineVerdict: coverageBaseline,
      ablatedVerdict: coverageAblated,
      explanation:
        "Bypassing bounded coverage converts an honest unknown into an unsupported claim that the requested fact was not found.",
    },
    {
      id: "no_identity_blockers",
      baselineVerdict: identityBaseline,
      ablatedVerdict: identityAblated,
      explanation:
        "Ignoring a hard identity ambiguity attaches evidence to an assumed entity and issues a falsely confident supported verdict.",
    },
    {
      id: "naive_field_alignment",
      baselineVerdict: alignmentBaseline,
      ablatedVerdict: alignmentAblated,
      explanation:
        "Treating same-named source fields as one predicate creates a false contradiction between distinct enterprise relations.",
    },
    {
      id: "no_graph_traversal",
      baselineVerdict: nativeBaseline,
      ablatedVerdict: nativeAblated,
      explanation:
        "Replacing HydraDB native traversal with bounded client expansion preserves this path only by issuing more graph queries and client-side bookkeeping.",
      baselineRoundTrips: input.nativePath.nativeRoundTrips,
      ablatedRoundTrips: input.nativePath.clientRoundTrips,
    },
  ];
}
