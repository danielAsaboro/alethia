import type { EvaluationFact } from "./contract";

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeFact(fact: EvaluationFact): EvaluationFact {
  switch (fact.kind) {
    case "text":
      return { kind: "text", value: normalizeText(fact.value) };
    case "number":
      return {
        kind: "number",
        value: finite(fact.value, "number"),
        ...(fact.unit ? { unit: normalizeText(fact.unit) } : {}),
      };
    case "percentage":
      return { kind: "percentage", value: finite(fact.value, "percentage") };
    case "duration": {
      const multipliers = { milliseconds: 0.001, seconds: 1, minutes: 60, hours: 3600 } as const;
      return {
        kind: "duration",
        value: finite(fact.value, "duration") * multipliers[fact.unit],
        unit: "seconds",
      };
    }
    case "identifier_set":
    case "entity_set":
      return {
        kind: fact.kind,
        values: [...new Set(fact.values.map(normalizeText))].sort(),
      };
    case "relationship_path":
      return { kind: "relationship_path", relationships: [...fact.relationships] };
  }
}

export function normalizedFactKey(fact: EvaluationFact): string {
  return JSON.stringify(normalizeFact(fact));
}
