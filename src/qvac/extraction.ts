import { z } from "zod";

const responseSchema = z.object({
  claims: z.array(
    z.object({
      predicate: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
      evidenceQuote: z.string().min(1),
    }),
  ),
});

export type GroundedExtraction = z.infer<typeof responseSchema>["claims"][number];

function jsonBody(text: string): string {
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? withoutThinking).trim();
}

export function validateQvacExtraction(input: {
  responseText: string;
  sourceText: string;
  allowedPredicates: string[];
}): GroundedExtraction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(input.responseText));
  } catch {
    throw new TypeError("QVAC extraction returned invalid JSON");
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    throw new TypeError("QVAC extraction returned an invalid schema");
  }
  const allowed = new Set(input.allowedPredicates);
  if (
    result.data.claims.some(
      (claim) =>
        !allowed.has(claim.predicate) ||
        !input.sourceText.includes(claim.evidenceQuote),
    )
  ) {
    throw new TypeError("QVAC extraction failed grounding validation");
  }
  return result.data.claims;
}
