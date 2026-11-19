import type { Metadata } from "next";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { FeedbackForm, FeedbackStatus } from "@/components/missio/feedback/public-form";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { FEEDBACK_TOKEN_PATTERN, feedbackAdmin, loadPublicFeedback } from "@/lib/missio/feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "House feedback · Missio" },
  description: "Four questions about this week's house church.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HouseFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const forwarded = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  if (forwardedFor) forwarded.set("x-forwarded-for", forwardedFor);
  if (realIp) forwarded.set("x-real-ip", realIp);
  const tokenHash = FEEDBACK_TOKEN_PATTERN.test(token) ? createHash("sha256").update(token).digest("hex") : undefined;
  const limited = await serveAvailabilityLimit(new Request("http://internal.local/feedback", { headers: forwarded }), "read", tokenHash);
  if (limited) return <FeedbackStatus state="limited" />;
  try {
    const result = await loadPublicFeedback(feedbackAdmin(), token);
    if (!result.ok) return <FeedbackStatus state={result.code === "invalid_token" ? "invalid" : "unavailable"} />;
    return <FeedbackForm token={token} view={result.view} />;
  } catch (error) {
    console.error("[serve/missio/feedback]", error instanceof Error ? error.message : "lookup failed");
    return <FeedbackStatus state="unavailable" />;
  }
}
