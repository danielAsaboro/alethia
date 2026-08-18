import { createHash } from "node:crypto";

import type { CausalArm } from "./causal-arms";

export const CAUSAL_PROMPT_VERSION = "causal-answer-v2";
export const CAUSAL_SYSTEM_PROMPT =
  'Answer only from the supplied enterprise records. Return one minified JSON object: {"answer":"concise answer or empty string","verdict":"SUPPORTED|DISPUTED|UNKNOWN|NOT_FOUND","evidenceDocumentIds":["document IDs"]}. Cite only supplied document IDs. The answer must be non-empty only when verdict is SUPPORTED. For DISPUTED, UNKNOWN, or NOT_FOUND, answer must be exactly the empty string, never a candidate answer. When records disagree and the supplied treatment does not establish a controlling current record, return DISPUTED. Return UNKNOWN when evidence is insufficient. Do not infer missing facts.';

export interface CausalGenerationResponse {
  answer: string;
  verdict: "SUPPORTED" | "DISPUTED" | "UNKNOWN" | "NOT_FOUND";
  evidenceDocumentIds: string[];
}

export function buildCausalGenerationRequest(arm: CausalArm, paddingTokens = 0) {
  if (!Number.isSafeInteger(paddingTokens) || paddingTokens < 0 || paddingTokens > 2048) throw new TypeError("Causal budget padding must be an integer from 0 through 2048");
  const prompt = JSON.stringify({
    promptVersion: CAUSAL_PROMPT_VERSION,
    treatment: {
      id: arm.id,
      reconcileConflicts: arm.promptMetadata.reconcileConflicts,
      graphGrounded: arm.promptMetadata.graphGrounded,
      identityResolution: arm.promptMetadata.identityResolution,
      ontologyAlignment: arm.promptMetadata.ontologyAlignment,
      conflictPolicy: arm.promptMetadata.conflictPolicy,
    },
    responseContract: {
      supported: "answer must be non-empty",
      disputed: "answer must be exactly empty string",
      unknown: "answer must be exactly empty string",
      notFound: "answer must be exactly empty string",
    },
    question: arm.question,
    documents: arm.documents.map((document) => ({
      id: document.id,
      sourceSystem: document.sourceSystem,
      lifecycle: arm.promptMetadata.graphGrounded ? document.lifecycle : "unknown",
      text: document.text,
    })),
    budgetPadding: Array.from({ length: paddingTokens }, () => "pad").join(" "),
  });
  return {
    promptVersion: CAUSAL_PROMPT_VERSION,
    promptTemplateSha256: createHash("sha256").update(CAUSAL_SYSTEM_PROMPT).digest("hex"),
    system: CAUSAL_SYSTEM_PROMPT,
    prompt,
    settings: { temperature: 0, maxOutputTokens: 220 } as const,
  };
}

export function validateCausalGenerationResponse(
  responseText: string,
  arm: CausalArm,
): CausalGenerationResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new TypeError("Causal generation returned malformed JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Causal generation response must be an object");
  }
  const row = parsed as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "answer,evidenceDocumentIds,verdict" ||
    typeof row.answer !== "string" ||
    !["SUPPORTED", "DISPUTED", "UNKNOWN", "NOT_FOUND"].includes(String(row.verdict)) ||
    !Array.isArray(row.evidenceDocumentIds) ||
    !row.evidenceDocumentIds.every((id) => typeof id === "string")
  ) {
    throw new TypeError("Causal generation response does not match the strict schema");
  }
  if (row.verdict !== "SUPPORTED" && row.answer.trim() !== "") {
    throw new TypeError("Abstaining verdicts require an empty answer");
  }
  const available = new Set(arm.documents.map((document) => document.id));
  const evidenceDocumentIds = uniqueStrings(row.evidenceDocumentIds as string[]);
  if (evidenceDocumentIds.some((id) => !available.has(id))) {
    throw new TypeError("Causal generation cited an unknown evidence document ID");
  }
  return {
    answer: row.answer.trim(),
    verdict: row.verdict as CausalGenerationResponse["verdict"],
    evidenceDocumentIds,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
