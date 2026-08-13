import { z } from "zod";

const ontologyName = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const dossierRequestSchema = z.object({
  question: z.string().trim().min(8).max(240),
  entityLogicalId: z.string().regex(/^entity_[a-z0-9_]+$/),
  predicate: ontologyName,
  sourceSystem: ontologyName,
  objectType: ontologyName,
  predicateFamily: ontologyName,
  contentScope: z.enum(["metadata", "body", "both"]),
});

export type DossierRequest = z.infer<typeof dossierRequestSchema>;
