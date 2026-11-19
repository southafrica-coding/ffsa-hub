import type { Metadata } from "next";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { LeaderSteps, PlacementStatus } from "@/components/missio/placements/public";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { leaderPage, placementAdmin, TOKEN_PATTERN } from "@/lib/missio/placements";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Welcome someone · Missio" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const forwarded = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  if (forwardedFor) forwarded.set("x-forwarded-for", forwardedFor);
  if (realIp) forwarded.set("x-real-ip", realIp);
  const tokenHash = TOKEN_PATTERN.test(token) ? createHash("sha256").update(token).digest("hex") : undefined;
  const limited = await serveAvailabilityLimit(new Request("http://internal.local/placement", { headers: forwarded }), "read", tokenHash);
  if (limited) return <PlacementStatus state="limited" />;
  try {
    const result = await leaderPage(placementAdmin(), token);
    if (!result.ok) return <PlacementStatus state={result.code === "invalid_token" ? "invalid" : "unavailable"} />;
    return <LeaderSteps token={token} view={result.view} />;
  } catch (error) {
    console.error("[serve/missio/l]", error instanceof Error ? error.message : "lookup failed");
    return <PlacementStatus state="unavailable" />;
  }
}
