import { createQvac } from "@qvac/ai-sdk-provider";
import { generateText } from "ai";

import { stableId } from "@/domain/ids";
import type { Claim } from "@/domain/ontology";
import type { GraphWriteBundle } from "@/hydra/client";
import {
  buildGroundingCandidates,
  type ConflictExtractionObservation,
  validateConflictSelection,
} from "./conflict-extraction";
import { validateQvacExtraction } from "./extraction";

export interface QvacPredicate {
  predicate: string;
  description: string;
}

export interface QvacExtractionInput {
  subjectEntityId: string;
  sourceObjectId: string;
  sourceSystem: string;
  sourceText: string;
  predicates: QvacPredicate[];
}

export interface QvacExtractionResult {
  claims: Claim[];
  evidenceQuotes: Record<string, string>;
  model: string;
}

export interface QvacConflictExtractionInput {
  questionId: string;
  question: string;
  sourceObjectId: string;
  sourceSystem: string;
  sourceNativeId: string;
  sourceTitle: string;
  sourceText: string;
  subjectHint: string;
}

export interface QvacConflictExtractionResult {
  observation: ConflictExtractionObservation;
  model: string;
  promptVersion: "conflict-observation-v11";
  responseText: string;
}

export class QvacConflictExtractionError extends Error {
  constructor(
    message: string,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "QvacConflictExtractionError";
  }
}

export function mapQvacClaimToGraph(
  claim: Claim,
  evidenceQuote: string,
): GraphWriteBundle {
  return {
    nodes: [
      {
        logicalId: claim.id,
        label: "Claim",
        properties: {
          predicate: claim.predicate,
          objectJson: JSON.stringify(claim.object),
          sourceSystem: claim.sourceSystem,
          extractionMethod: claim.extractionMethod,
          extractorVersion: claim.extractorVersion,
          evidenceQuote,
        },
      },
    ],
    edges: [
      {
        logicalId: stableId("edge", {
          type: "ASSERTS",
          sourceLogicalId: claim.subjectEntityId,
          targetLogicalId: claim.id,
        }),
        type: "ASSERTS",
        sourceLabel: "Entity",
        sourceLogicalId: claim.subjectEntityId,
        targetLabel: "Claim",
        targetLogicalId: claim.id,
        properties: {},
      },
      {
        logicalId: stableId("edge", {
          type: "SUPPORTED_BY",
          sourceLogicalId: claim.id,
          targetLogicalId: claim.sourceObjectId,
        }),
        type: "SUPPORTED_BY",
        sourceLabel: "Claim",
        sourceLogicalId: claim.id,
        targetLabel: "SourceObject",
        targetLogicalId: claim.sourceObjectId,
        properties: {},
      },
    ],
  };
}

export class QvacClient {
  constructor(
    private readonly baseUrl = process.env.QVAC_BASE_URL ??
      "http://127.0.0.1:11436/v1",
    private readonly model = process.env.QVAC_MODEL ??
      "sourcetruce-extractor",
  ) {}

  async extractClaims(input: QvacExtractionInput): Promise<QvacExtractionResult> {
    const qvac = createQvac({
      baseURL: this.baseUrl.replace(/\/$/, ""),
      apiKey: process.env.QVAC_API_KEY ?? "local-loopback-only",
    });
    const { text: responseText } = await generateText({
      model: qvac(this.model),
      abortSignal: AbortSignal.timeout(120_000),
      temperature: 0,
      maxOutputTokens: 500,
      system:
        "Extract only explicit facts from the source text. Return JSON only: {\"claims\":[{\"predicate\":\"one allowed predicate\",\"value\":\"exact value\",\"evidenceQuote\":\"exact contiguous quote from source\"}]}. Do not infer. Return {\"claims\":[]} when no allowed fact is explicit.",
      prompt: JSON.stringify({
        allowedPredicates: input.predicates,
        sourceText: input.sourceText,
      }),
    });
    const extracted = validateQvacExtraction({
      responseText,
      sourceText: input.sourceText,
      allowedPredicates: input.predicates.map((item) => item.predicate),
    });
    const evidenceQuotes: Record<string, string> = {};
    const claims = extracted.map((item) => {
      const id = stableId("claim", {
        subjectEntityId: input.subjectEntityId,
        predicate: item.predicate,
        value: item.value,
        sourceObjectId: input.sourceObjectId,
        extractorVersion: `qvac:${this.model}`,
        evidenceQuote: item.evidenceQuote,
      });
      evidenceQuotes[id] = item.evidenceQuote;
      return {
        id,
        subjectEntityId: input.subjectEntityId,
        predicate: item.predicate,
        object: { kind: "literal", value: item.value } as const,
        sourceObjectId: input.sourceObjectId,
        sourceSystem: input.sourceSystem,
        extractionMethod: "qvac" as const,
        extractorVersion: `qvac:${this.model}`,
      };
    });
    return { claims, evidenceQuotes, model: this.model };
  }

  async extractConflictObservation(
    input: QvacConflictExtractionInput,
  ): Promise<QvacConflictExtractionResult> {
    const qvac = createQvac({
      baseURL: this.baseUrl.replace(/\/$/, ""),
      apiKey: process.env.QVAC_API_KEY ?? "local-loopback-only",
    });
    const promptVersion = "conflict-observation-v11" as const;
    const candidates = buildGroundingCandidates({
      question: input.question,
      sourceText: input.sourceText,
      limit: 8,
    });
    if (candidates.length === 0) {
      throw new TypeError("Source has no eligible grounding candidates");
    }
    const { text: responseText } = await generateText({
      model: qvac(this.model),
      abortSignal: AbortSignal.timeout(120_000),
      temperature: 0,
      maxOutputTokens: 180,
      system:
        'Select the one numbered source candidate that most completely answers the question. Candidates may contain an exact multi-line source block. Return one minified JSON object only: {"candidateIndex":NUMBER,"value":"SHORTEST EXACT ANSWER SPAN, AT MOST 160 CHARACTERS","lifecycle":"ONE ALLOWED WORD"}. Use exactly those three keys once. Prefer a complete current setting, rule, or list over a heading. The value must be a contiguous substring of the selected candidate and must not repeat the full candidate. Do not quote the question, invent evidence, resolve conflicts across sources, or add explanation.',
      prompt: JSON.stringify({
        promptVersion,
        requiredPredicate: "conflict_answer",
        questionId: input.questionId,
        question: input.question,
        source: {
          sourceObjectId: input.sourceObjectId,
          sourceSystem: input.sourceSystem,
          sourceNativeId: input.sourceNativeId,
          title: input.sourceTitle,
        },
        candidates,
        allowedLifecycle: [
          "proposal",
          "approved",
          "applied",
          "deprecated",
          "unknown",
        ],
      }),
    });
    try {
      return {
        observation: validateConflictSelection({
          responseText,
          candidates,
          sourceText: input.sourceText,
          question: input.question,
          subject: input.subjectHint,
          predicate: "conflict_answer",
        }),
        model: this.model,
        promptVersion,
        responseText,
      };
    } catch (error) {
      throw new QvacConflictExtractionError(
        error instanceof Error ? error.message : String(error),
        responseText,
      );
    }
  }
}
