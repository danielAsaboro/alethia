import type {
  AnswerValueGroup,
  ConsolidatedClaim,
  ConsolidatedClaims,
} from "@/domain/evidence";

function displayValue(claim: ConsolidatedClaim): string {
  return claim.object.kind === "literal"
    ? String(claim.object.value)
    : claim.object.entityId;
}

function normalizedValue(claim: ConsolidatedClaim): string {
  if (claim.object.kind === "entity") {
    return `entity:${claim.object.entityId}`;
  }
  const value = claim.object.value;
  if (typeof value !== "string") {
    return `${typeof value}:${String(value)}`;
  }
  return `string:${value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US")}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function groupAnswerValues(
  bundle: ConsolidatedClaims,
): AnswerValueGroup[] {
  const groups = new Map<
    string,
    {
      labels: string[];
      claimIds: string[];
      observationIds: string[];
      sourceObjectIds: string[];
    }
  >();

  for (const claim of bundle.claims) {
    const key = normalizedValue(claim);
    const group = groups.get(key) ?? {
      labels: [],
      claimIds: [],
      observationIds: [],
      sourceObjectIds: [],
    };
    group.labels.push(displayValue(claim));
    group.claimIds.push(claim.id);
    group.observationIds.push(...claim.observationIds);
    group.sourceObjectIds.push(claim.sourceObjectId);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group): AnswerValueGroup => {
      const claimIds = uniqueSorted(group.claimIds);
      const observationIds = uniqueSorted(group.observationIds);
      const sourceObjectIds = uniqueSorted(group.sourceObjectIds);
      return {
        valueLabel: [...group.labels].sort((left, right) =>
          left.localeCompare(right),
        )[0],
        claimIds,
        observationIds,
        sourceObjectIds,
        claimCount: claimIds.length,
        observationCount: observationIds.length,
      };
    })
    .sort((left, right) => left.valueLabel.localeCompare(right.valueLabel));
}
