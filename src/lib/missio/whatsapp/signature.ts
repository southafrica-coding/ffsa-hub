// ────────────────────────────────────────────────────────────
// Missio WhatsApp — webhook checks
// ────────────────────────────────────────────────────────────
// Meta signs every POST with X-Hub-Signature-256: "sha256=" + hex
// HMAC-SHA256(app secret, raw body). The GET handshake echoes hub.challenge
// when hub.verify_token matches ours. Both compares are timing-safe; the
// verify token is hashed first so the two sides are the same length, as
// src/lib/cron-auth.ts does.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True only for a well-formed header whose HMAC matches the exact raw body. */
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1].toLowerCase(), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type HandshakeResult = { ok: true; challenge: string } | { ok: false };

/** Meta's subscribe handshake. Anything but an exact token match is refused. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): HandshakeResult {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (!verifyToken || mode !== "subscribe" || !challenge || challenge.length > 200) return { ok: false };
  return timingSafeEqual(digest(token), digest(verifyToken)) ? { ok: true, challenge } : { ok: false };
}
