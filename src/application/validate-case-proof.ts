import type { CaseWorkspace } from "./run-case";

export interface CaseProofRequirements {
  sourceLogicalId: string;
  targetLogicalId: string;
  sourceLabel: string;
  targetLabel: string;
  relationshipTypes: string[];
  minimumPathLength: number;
  maximumPathLength: number;
}

function sameSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateCaseProof<T extends CaseWorkspace>(
  workspace: T,
  requirements: CaseProofRequirements,
): T {
  const proof = workspace.graphProof;
  const source = proof.nodes[0];
  const target = proof.nodes.at(-1);
  const valid =
    proof.consistency === "strong" &&
    proof.roundTrips >= 1 &&
    proof.queryIds.length === proof.roundTrips &&
    new Set(proof.queryIds).size === proof.queryIds.length &&
    proof.queryIds.every((queryId) => queryId.trim() !== "") &&
    proof.queryId.trim() !== "" &&
    proof.pathLength === proof.relationshipTypes.length &&
    proof.pathLength >= requirements.minimumPathLength &&
    proof.pathLength <= requirements.maximumPathLength &&
    sameSequence(proof.relationshipTypes, requirements.relationshipTypes) &&
    source?.logicalId === requirements.sourceLogicalId &&
    target?.logicalId === requirements.targetLogicalId &&
    source.labels.includes(requirements.sourceLabel) &&
    target.labels.includes(requirements.targetLabel);
  if (!valid) throw new Error("Required HydraDB graph proof does not match the case requirements");
  return workspace;
}
