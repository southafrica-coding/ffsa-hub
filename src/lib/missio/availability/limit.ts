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

/** Public link reads and saves. The key is the IP and, once known, the token hash. Never the raw token. */
export async function serveAvailabilityLimit(
  request: Request,
  bucket: "read" | "write",
  tokenHash?: string
): Promise<NextResponse | null> {
  const ip = clientIp(request);
  const ipHit = await getRateLimiter().hit(`serve:missio:${bucket}:${ip}`, {
    limit: bucket === "read" ? 40 : 20,
    windowSeconds: 600,
  });
  if (!ipHit.allowed) {
    return limited(ipHit, "Too many tries. Wait a minute, then open the link again.");
  }
  if (!tokenHash) return null;
  const tokenHit = await getRateLimiter().hit(`serve:missio:${bucket}:token:${tokenHash}`, {
    limit: bucket === "read" ? 40 : 20,
    windowSeconds: 600,
  });
  if (!tokenHit.allowed) {
    return limited(tokenHit, "Too many tries. Wait a minute, then open the link again.");
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
