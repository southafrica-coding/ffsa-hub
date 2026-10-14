// Slack request signing (HMAC-SHA256 over "v0:<timestamp>:<raw body>").
// Shared by every inbound Slack endpoint — events and interactivity — which
// authenticate by signing secret instead of a session cookie.

import crypto from "node:crypto";

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // Replay guard: reject timestamps more than 5 minutes off.
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — length-guard first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
