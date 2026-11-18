import { NextResponse } from "next/server";
import { clientIp, getRateLimiter, retryAfterSeconds, type RateLimitResult } from "@/lib/rate-limit";

function limited(result: RateLimitResult, message: string) {
  return NextResponse.json(
    { error: message, code: "rate_limited" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds(result)),
      },
    }
  );
}

/**
 * Public link reads and saves. Writes are limited per token hash first, with a
 * high per-IP ceiling so a shared church network is not locked out. Never the raw token.
 */
export async function serveAvailabilityLimit(
  request: Request,
  bucket: "read" | "write",
  tokenHash?: string
): Promise<NextResponse | null> {
  const message = "Too many tries. Wait a minute, then open the link again.";
  if (bucket === "write" && tokenHash) {
    const tokenHit = await getRateLimiter().hit(`serve:missio:write:token:${tokenHash}`, {
      limit: 30,
      windowSeconds: 600,
    });
    if (!tokenHit.allowed) return limited(tokenHit, message);
  }
  const ip = clientIp(request);
  const ipHit = await getRateLimiter().hit(`serve:missio:${bucket}:${ip}`, {
    limit: bucket === "write" ? 400 : 80,
    windowSeconds: 600,
  });
  if (!ipHit.allowed) return limited(ipHit, message);
  if (bucket === "read" && tokenHash) {
    const tokenHit = await getRateLimiter().hit(`serve:missio:read:token:${tokenHash}`, {
      limit: 80,
      windowSeconds: 600,
    });
    if (!tokenHit.allowed) return limited(tokenHit, message);
  }
  return null;
}

export async function pastorAvailabilityLimit(
  userId: string,
  bucket: "write" | "link" | "nudge"
): Promise<NextResponse | null> {
  const options =
    bucket === "nudge" ? { limit: 5, windowSeconds: 600 } : { limit: 30, windowSeconds: 60 };
  const hit = await getRateLimiter().hit(`missio:volunteer-${bucket}:${userId}`, options);
  if (hit.allowed) return null;
  const message =
    bucket === "nudge"
      ? "Too many message drafts. Wait a few minutes."
      : "Too many changes. Try again shortly.";
  return limited(hit, message);
}
