import type { IdentityObservation } from "@/ingestion/source-adapter";

export function identityKey(identity: IdentityObservation): string {
  const namespace = identity.kind === "email" ? "global" : identity.sourceSystem;
  return `${identity.kind}:${namespace}:${identity.normalizedValue}`;
}
