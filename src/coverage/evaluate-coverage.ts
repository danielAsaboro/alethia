import type {
  ContentScope,
  CoverageAssessment,
  CoverageGap,
  CoverageRequirement,
  CoverageSlice,
  RequiredCoverageSlice,
} from "@/domain/ontology";

function coversContent(actual: ContentScope, required: ContentScope): boolean {
  return actual === "both" || actual === required;
}

function explainGap(
  requirement: RequiredCoverageSlice,
  slices: CoverageSlice[],
): CoverageGap | null {
  const matchingObjects = slices.filter(
    (slice) =>
      slice.sourceSystem === requirement.sourceSystem &&
      slice.objectType === requirement.objectType,
  );

  if (matchingObjects.length === 0) {
    return {
      sourceSystem: requirement.sourceSystem,
      objectType: requirement.objectType,
      predicateFamily: requirement.predicateFamily,
      reason: "slice_missing",
    };
  }

  const completeSlices = matchingObjects.filter(
    (slice) => slice.status === "complete",
  );
  if (completeSlices.length === 0) {
    return {
      sourceSystem: requirement.sourceSystem,
      objectType: requirement.objectType,
      predicateFamily: requirement.predicateFamily,
      reason: matchingObjects.some((slice) => slice.status === "failed")
        ? "ingestion_failed"
        : "ingestion_incomplete",
    };
  }

  const predicateSlices = completeSlices.filter((slice) =>
    slice.predicateFamilies.includes(requirement.predicateFamily),
  );
  if (predicateSlices.length === 0) {
    return {
      sourceSystem: requirement.sourceSystem,
      objectType: requirement.objectType,
      predicateFamily: requirement.predicateFamily,
      reason: "predicate_not_examined",
    };
  }

  if (
    !predicateSlices.some((slice) =>
      coversContent(slice.contentScope, requirement.contentScope),
    )
  ) {
    return {
      sourceSystem: requirement.sourceSystem,
      objectType: requirement.objectType,
      predicateFamily: requirement.predicateFamily,
      reason: "content_not_examined",
    };
  }

  return null;
}

export function evaluateCoverage(
  requirement: CoverageRequirement,
  slices: CoverageSlice[],
): CoverageAssessment {
  const missing = requirement.slices
    .map((required) => explainGap(required, slices))
    .filter((gap): gap is CoverageGap => gap !== null);

  return {
    sufficient: missing.length === 0,
    missing,
  };
}
