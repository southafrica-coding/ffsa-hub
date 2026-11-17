import { createHash } from "crypto";

/** Opaque token for one pastor, one contact, and the normalised email or phone they searched. */
export function missioMatchToken(userId: string, contactId: string, normalizedMatchValue: string): string {
  return createHash("sha256").update(`${userId}|${contactId}|${normalizedMatchValue}`).digest("base64url");
}

/** Hex digest of the normalised search. Stored in the audit row instead of the query. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
