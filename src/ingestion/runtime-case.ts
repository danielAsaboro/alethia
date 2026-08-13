import { z } from "zod";

const ontologyToken = z.string().regex(/^[a-z][a-z0-9_]*$/);

const requiredCoverageSliceSchema = z
  .object({
    sourceSystem: ontologyToken,
    objectType: ontologyToken,
    predicateFamily: ontologyToken,
    contentScope: z.enum(["metadata", "body", "both"]),
  })
  .strict();

export const runtimeCaseSchema = z
  .object({
    questionId: z.string().regex(/^qst_[a-z0-9_]+$/),
    question: z.string().trim().min(8).max(1_000),
    sourceTypes: z.array(ontologyToken).min(1),
    predicateFamily: ontologyToken,
    coverageRequirement: z
      .object({
        slices: z.array(requiredCoverageSliceSchema).min(1),
      })
      .strict(),
  })
  .strict();

export type RuntimeCase = z.infer<typeof runtimeCaseSchema>;
