/**
 * Slack request signing-secret verification (HMAC v0).
 *
 * Shared by every inbound Slack endpoint — events, slash commands,
 * and interactivity. All Slack requests carry the same signature
 * scheme, so this is the single source of truth.
 *
 * Callers MUST pass the RAW request body (read via `await req.text()`)
 * before any JSON/form parsing — the HMAC is computed over the exact
 * bytes Slack sent.
 */

import crypto from "node:crypto";

/** Reject requests whose timestamp is more than 5 minutes off (replay guard). */
const MAX_SKEW_SECONDS = 60 * 5;

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — length-guard first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Convenience wrapper that reads the standard Slack signature headers. */
export function verifySlackRequest(rawBody: string, headers: Headers): boolean {
  return verifySlackSignature(
    rawBody,
    headers.get("x-slack-request-timestamp"),
    headers.get("x-slack-signature")
  );
}
