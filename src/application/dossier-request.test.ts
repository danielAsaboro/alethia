import { describe, expect, it } from "vitest";

import { dossierRequestSchema } from "./dossier-request";

describe("dossierRequestSchema", () => {
  it("accepts a fully scoped evidence question", () => {
    expect(
      dossierRequestSchema.parse({
        question: "What is this person's role?",
        entityLogicalId: "entity_90ad19476a96ae677e3c9143",
        predicate: "has_role",
        sourceSystem: "herb",
        objectType: "employee",
        predicateFamily: "role",
        contentScope: "metadata",
      }),
    ).toMatchObject({ predicate: "has_role", predicateFamily: "role" });
  });

  it("rejects arbitrary graph labels and unscoped questions", () => {
    expect(() =>
      dossierRequestSchema.parse({ question: "?", entityLogicalId: "x" }),
    ).toThrow();
  });
});
