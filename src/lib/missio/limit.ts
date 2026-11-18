import { NextResponse } from "next/server";
import { getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";

// Separate buckets so a burst of searches does not lock someone out of adding
// a person, and the other way around. About 20 a minute per user.
export async function missioRateLimit(
  userId: string,
  bucket: "contact-search" | "person-create" | "house-church-write"
): Promise<NextResponse | null> {
  const limit = await getRateLimiter().hit(`missio:${bucket}:${userId}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (limit.allowed) return null;
  const message =
    bucket === "contact-search"
      ? "Too many searches. Try again shortly."
      : "Too many attempts. Try again shortly.";
  return NextResponse.json(
    { error: message, code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit)) } }
  );
}
