import { headers } from "next/headers";
import { WeeklyFeedbackFill } from "@/components/missio/weekly/fill";
import { GuideStatus } from "@/components/missio/weekly/surface";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { listPublicHouses } from "@/lib/missio/public-feedback";
import { MISSIO_PUBLIC_FEEDBACK_PATH } from "@/lib/missio/public-feedback-link";
import { feedbackSunday } from "@/lib/missio/weekly-feedback";
import { missioWeeklyFeedbackSchema } from "@/lib/forms/templates/missio-weekly-feedback";
import type { FormSchema } from "@/lib/forms/schema";

// ============================================================
// /f/missio-weekly-feedback — the one public link (Jack, 23 Nov 2026)
// ============================================================
// No login, no token. The house church picker comes first; the rest
// is the same weekly form the house links show. Nothing about a house
// is prefilled here (anyone can open this page, so last week's answers
// and counts stay off it), and the page carries only each house's id,
// number and name.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function isSchema(raw: unknown): raw is FormSchema {
  return Boolean(raw && typeof raw === "object" && Array.isArray((raw as FormSchema).steps));
}

export async function MissioPublicWeeklyFeedback({ db, schema }: { db: Db; schema: unknown }) {
  const headerList = await headers();
  const forwarded = new Headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  if (forwardedFor) forwarded.set("x-forwarded-for", forwardedFor);
  if (realIp) forwarded.set("x-real-ip", realIp);
  const limited = await serveAvailabilityLimit(new Request("http://internal.local/f/feedback", { headers: forwarded }), "read");
  if (limited) {
    return <GuideStatus eyebrow="Weekly feedback" title="Too many tries" body="Wait a minute, then open the link again." state="limited" />;
  }

  const houses = await listPublicHouses(db);
  if (houses.length === 0) {
    return <GuideStatus eyebrow="Weekly feedback" title="This didn’t load" body="Try again in a minute." state="unavailable" />;
  }

  return (
    <WeeklyFeedbackFill
      houseNumber={0}
      leaders={null}
      // For the heading only: every house meets on Sunday today. The saved
      // date is worked out per house on the server (feedbackSunday).
      meetingDate={feedbackSunday(null)}
      lastAttendance={null}
      initial={{}}
      sentBefore={false}
      schema={isSchema(schema) ? schema : missioWeeklyFeedbackSchema()}
      endpoint={`/api${MISSIO_PUBLIC_FEEDBACK_PATH}/submit`}
      picker={{ houses }}
    />
  );
}
