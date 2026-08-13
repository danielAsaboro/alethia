import { createHash } from "node:crypto";

function canonicalJson(value: unknown, path = "$"): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Unsupported non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }

  if (typeof value === "undefined") {
    throw new TypeError(`Unsupported undefined value at ${path}`);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => canonicalJson(item, `${path}[${index}]`))
      .join(",")}]`;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Unsupported object type at ${path}`);
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`,
      );
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported ${typeof value} value at ${path}`);
}

export function stableId(namespace: string, value: unknown): string {
  if (!/^[a-z][a-z0-9_]*$/.test(namespace)) {
    throw new TypeError(`Invalid ID namespace: ${namespace}`);
  }

  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex")
    .slice(0, 24);

  return `${namespace}_${digest}`;
}
