import type { Metadata } from "next";
import { headers } from "next/headers";
import { PublicCalendar } from "@/components/missio/calendar/calendar";
import { missioBody, missioDisplay, missioMono } from "@/components/missio/fonts";
import { publicFeedClient, readCalendarByToken } from "@/lib/missio/calendar/data";
import { calendarFeedLimit } from "@/lib/missio/calendar/limit";
import { CALENDAR_TOKEN_PATTERN, hashCalendarToken } from "@/lib/missio/calendar/token";
import { missioSkinVars } from "@/components/missio/access";
import type { CSSProperties } from "react";

// /serve/missio/calendar/<token>  Public, read-only. The same calendar as the
// .ics feed, in Missio's look, with no edit controls. A wrong or reset token
// shows the same "not found" as a link that never existed.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Calendar · Missio" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const skin = missioSkinVars() as CSSProperties;

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ ...skin, minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "var(--page)" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--font-missio-display), Fraunces, Georgia, serif", fontWeight: 560, fontSize: 26 }}>{title}</h1>
        <p style={{ color: "var(--ink-2)" }}>{body}</p>
      </div>
    </div>
  );
}

export default async function PublicMissioCalendarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headerList = await headers();
  const forwarded = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  if (forwardedFor) forwarded.set("x-forwarded-for", forwardedFor);
  if (realIp) forwarded.set("x-real-ip", realIp);
  const valid = CALENDAR_TOKEN_PATTERN.test(token);
  const limited = await calendarFeedLimit(new Request("http://internal.local/calendar", { headers: forwarded }), valid ? hashCalendarToken(token) : null);

  let body: React.ReactNode;
  if (limited) {
    body = <Message title="Too many visits" body="Wait a few minutes, then open the link again." />;
  } else {
    try {
      const result = valid ? await readCalendarByToken(publicFeedClient(), token) : null;
      if (result?.ok) body = <PublicCalendar name={result.name} events={result.events} />;
      else if (!result || result.status === 404)
        body = <Message title="This link isn’t right" body="It may have been reset. Ask a Missio pastor for the current calendar link." />;
      else body = <Message title="The calendar didn’t load" body="Please try again in a few minutes." />;
    } catch (error) {
      console.error("[serve/missio/calendar]", error instanceof Error ? error.message : "lookup failed");
      body = <Message title="The calendar didn’t load" body="Please try again in a few minutes." />;
    }
  }

  return (
    <div
      data-missio-font=""
      data-org="missio"
      className={`${missioBody.variable} ${missioDisplay.variable} ${missioMono.variable} ${missioBody.className}`}
      style={skin}
    >
      {body}
    </div>
  );
}
