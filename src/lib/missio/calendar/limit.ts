import { NextResponse } from "next/server";
import { clientIp, getRateLimiter, retryAfterSeconds, type RateLimitResult } from "@/lib/rate-limit";

function limited(result: RateLimitResult, message: string, cacheControl: string) {
  return NextResponse.json(
    { error: message, code: "rate_limited" },
    { status: 429, headers: { "Cache-Control": cacheControl, "Retry-After": String(retryAfterSeconds(result)) } }
  );
}

/** Pastor edits and link resets: about 30 a minute each. */
export async function calendarPastorLimit(userId: string, bucket: "write" | "share"): Promise<NextResponse | null> {
  const hit = await getRateLimiter().hit(`missio:calendar:${bucket}:${userId}`, {
    limit: bucket === "write" ? 30 : 10,
    windowSeconds: 60,
  });
  return hit.allowed ? null : limited(hit, "Too many changes at once. Try again shortly.", "no-store");
}

/**
 * The public feed. Calendar apps poll it every few hours, and Google
 * fetches from shared addresses, so the per-IP ceiling is generous; the
 * per-token limit stops one leaked link being hammered. Never the raw token.
 */
export async function calendarFeedLimit(request: Request, tokenHash: string | null): Promise<NextResponse | null> {
  const message = "Too many requests. Try again later.";
  const ipHit = await getRateLimiter().hit(`serve:missio:calendar:ip:${clientIp(request)}`, { limit: 300, windowSeconds: 600 });
  if (!ipHit.allowed) return limited(ipHit, message, "no-store");
  if (tokenHash) {
    const tokenHit = await getRateLimiter().hit(`serve:missio:calendar:token:${tokenHash}`, { limit: 600, windowSeconds: 600 });
    if (!tokenHit.allowed) return limited(tokenHit, message, "no-store");
  }
  return null;
}
