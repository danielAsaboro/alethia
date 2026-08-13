import { createHash } from "node:crypto";

export function hydraIntId(logicalId: string): number {
  const hex = createHash("sha256").update(logicalId).digest("hex").slice(0, 13);
  return Number.parseInt(hex, 16);
}
