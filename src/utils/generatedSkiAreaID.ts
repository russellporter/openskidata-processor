import { createHash } from "crypto";

// Fixed namespace for generated ski area IDs. Chosen once and never changed: changing it
// would rename every generated ski area in the output.
const NAMESPACE = "4f1a3c7e-9b2d-4e8a-8f5c-1d6b0a2e7c94";

/**
 * Derives a stable ID for a ski area that the processor generates itself, from the set of
 * objects it contains.
 *
 * Generated ski areas have no upstream identifier, so this used to be `randomUUID()`.
 * That made the output irreproducible: the same input produced different IDs on every
 * run, which in turn made it impossible to diff two runs or to compare the output of two
 * implementations. Deriving the ID from the member set instead makes it a function of the
 * data.
 *
 * Member sets are disjoint — clustering consumes objects, so an object belongs to at most
 * one generated ski area — which is what makes the member set a usable identity.
 *
 * The result is formatted as an RFC 4122 version 5 UUID so it keeps the shape the
 * previous `randomUUID()` values had.
 */
export function generatedSkiAreaID(memberKeys: readonly string[]): string {
  if (memberKeys.length === 0) {
    throw new Error("Cannot derive a ski area ID from an empty member set");
  }

  // Sorted so the ID does not depend on traversal order, and newline-joined because
  // member keys are hex hashes that cannot contain a newline, so the encoding is
  // unambiguous.
  const name = [...memberKeys].sort().join("\n");

  const hash = createHash("sha1");
  hash.update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex"));
  hash.update(name, "utf8");
  const bytes = hash.digest();

  // RFC 4122 section 4.3: set the version to 5 and the variant to RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-");
}
