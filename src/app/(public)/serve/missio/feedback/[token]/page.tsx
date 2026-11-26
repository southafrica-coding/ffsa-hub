import type { Metadata } from "next";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { WeeklyFeedbackFill } from "@/components/missio/weekly/fill";
import { GuideStatus } from "@/components/missio/weekly/surface";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { FEEDBACK_TOKEN_PATTERN, feedbackAdmin, resolveFeedbackLink } from "@/lib/missio/feedback";
import { loadWeeklyFillView, loadWeeklyHouse } from "@/lib/missio/weekly-feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Weekly feedback · MissioSA" },
  description: "This week's house church feedback, about five minutes.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// The house's own link (M4a, migration 339): no login, the token is the
// only key. It now opens the full weekly form (F4). The house comes from
// the link, never from a dropdown.

const STATUS = {
  invalid: { title: "This link doesn’t work", body: "Ask your pastor or coach to send the house’s link again." },
  limited: { title: "Too many tries", body: "Wait a minute, then open the link again." },
  unavailable: { title: "This didn’t load", body: "Try again in a minute." },
} as const;

function Status({ state }: { state: keyof typeof STATUS }) {
  return <GuideStatus eyebrow="Weekly feedback" title={STATUS[state].title} body={STATUS[state].body} state={state} />;
}

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
  if (limited) return <Status state="limited" />;
  try {
    const db = feedbackAdmin();
    const link = await resolveFeedbackLink(db, token);
    if (!link.ok) return <Status state={link.code === "invalid_token" ? "invalid" : "unavailable"} />;
    const house = await loadWeeklyHouse(db, link.houseId);
    if (!house) return <Status state="invalid" />;
    const view = await loadWeeklyFillView(db, house);
    if (!view.open) {
      return (
        <GuideStatus
          eyebrow={`House ${house.number} · Weekly feedback`}
          title={
            <>
              Opens <em>soon.</em>
            </>
          }
          body="Weekly feedback isn’t open yet. Your pastor will let you know when it is. Keep this link: it’s your house’s."
          nav={{ label: `House ${house.number}` }}
          state="not_open"
        />
      );
    }
    return (
      <WeeklyFeedbackFill
        houseNumber={view.houseNumber}
        leaders={view.leaders}
        meetingDate={view.meetingDate}
        lastAttendance={view.lastAttendance}
        initial={view.initial}
        sentBefore={view.sentBefore}
        schema={view.schema}
        endpoint={`/api/serve/missio/feedback/${encodeURIComponent(token)}`}
      />
    );
  } catch (error) {
    console.error("[serve/missio/feedback]", error instanceof Error ? error.message : "lookup failed");
    return <Status state="unavailable" />;
  }
}
