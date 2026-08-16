import { createHash } from "node:crypto";

/** Stable positive integer that remains exactly representable in JSON/JavaScript. */
export function stableId(value: string): number {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 13);
  return Number.parseInt(hex, 16);
}
