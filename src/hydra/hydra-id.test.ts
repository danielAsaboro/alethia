import { describe, expect, it } from "vitest";

import { hydraIntId } from "./hydra-id";

describe("hydraIntId", () => {
  it("maps a logical ID to a stable non-negative safe integer", () => {
    expect(hydraIntId("entity_abc")).toBe(4287677898268908);
    expect(Number.isSafeInteger(hydraIntId("entity_abc"))).toBe(true);
  });

  it("keeps different logical namespaces distinct", () => {
    expect(hydraIntId("entity_abc")).not.toBe(hydraIntId("claim_abc"));
  });
});
