import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

export interface EvidenceClaim {
  id: string;
  claim: string;
  value: unknown;
  artifact: string;
  jsonPointer: string;
  command: string;
  commit: string;
  timestamp: string;
  qualifier: string;
  datasetDigest?: string;
  modelDigest?: string;
}

export interface EvidenceAssertion {
  artifact: string;
  jsonPointer: string;
  value: unknown;
}

export interface GroupedEvidenceClaim {
  id: string;
  claim: string;
  command: string;
  commit: string;
  timestamp: string;
  qualifier: string;
  assertions: EvidenceAssertion[];
  datasetDigest?: string;
  modelDigest?: string;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function valueAtJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) throw new TypeError("Claim JSON pointer must start with /");
  let current = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodePointerSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) throw new TypeError(`Claim JSON pointer is missing segment ${segment}`);
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !(segment in current)) throw new TypeError(`Claim JSON pointer is missing segment ${segment}`);
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export async function verifyClaim(claim: EvidenceClaim) {
  if (!claim.id || !claim.claim || !claim.command || !claim.commit || !claim.qualifier || Number.isNaN(Date.parse(claim.timestamp))) {
    throw new TypeError("Claim metadata is incomplete");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(claim.artifact);
  } catch (error) {
    throw new Error(`Claim artifact is unavailable: ${claim.artifact}`, { cause: error });
  }
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Claim artifact is not valid JSON: ${claim.artifact}`, { cause: error });
  }
  const observed = valueAtJsonPointer(document, claim.jsonPointer);
  if (!isDeepStrictEqual(observed, claim.value)) {
    throw new Error(`Claim value mismatch for ${claim.id}: expected ${JSON.stringify(claim.value)}, observed ${JSON.stringify(observed)}`);
  }
  return {
    ...claim,
    verified: true as const,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function verifyGroupedClaim(claim: GroupedEvidenceClaim) {
  if (!claim.id || !claim.claim || !claim.command || !claim.commit || !claim.qualifier || Number.isNaN(Date.parse(claim.timestamp)) || !Array.isArray(claim.assertions) || claim.assertions.length === 0) {
    throw new TypeError("Grouped claim metadata is incomplete");
  }
  const cache = new Map<string, { bytes: Buffer; document: unknown; sha256: string }>();
  const verifiedAssertions = [];
  for (const assertion of claim.assertions) {
    let artifact = cache.get(assertion.artifact);
    if (!artifact) {
      let bytes: Buffer;
      try {
        bytes = await readFile(assertion.artifact);
      } catch (error) {
        throw new Error(`Claim artifact is unavailable: ${assertion.artifact}`, { cause: error });
      }
      let document: unknown;
      try {
        document = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        throw new Error(`Claim artifact is not valid JSON: ${assertion.artifact}`, { cause: error });
      }
      artifact = { bytes, document, sha256: createHash("sha256").update(bytes).digest("hex") };
      cache.set(assertion.artifact, artifact);
    }
    const observed = valueAtJsonPointer(artifact.document, assertion.jsonPointer);
    if (!isDeepStrictEqual(observed, assertion.value)) {
      throw new Error(`Claim value mismatch for ${claim.id}: expected ${JSON.stringify(assertion.value)}, observed ${JSON.stringify(observed)}`);
    }
    verifiedAssertions.push({ ...assertion, verified: true as const });
  }
  return {
    ...claim,
    assertions: verifiedAssertions,
    artifacts: [...cache.entries()].map(([artifact, value]) => ({ artifact, sha256: value.sha256, bytes: value.bytes.length })),
    verified: true as const,
  };
}
