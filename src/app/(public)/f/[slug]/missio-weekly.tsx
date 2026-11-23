import { headers } from "next/headers";
import { WeeklyFeedbackFill } from "@/components/missio/weekly/fill";
import { GuideStatus } from "@/components/missio/weekly/surface";
import { serveAvailabilityLimit } from "@/lib/missio/availability/limit";
import { listPublicHouses, publicRenderSchema } from "@/lib/missio/public-feedback";
import { MISSIO_PUBLIC_FEEDBACK_PATH, preselectedHouseId } from "@/lib/missio/public-feedback-link";
import { missioWeeklyFeedbackSchema } from "@/lib/forms/templates/missio-weekly-feedback";
import type { FormSchema } from "@/lib/forms/schema";

// ============================================================
// /f/missio-weekly-feedback — the one public link (Jack, 23 Nov 2026)
// ============================================================
// No login, no token. The house church picker comes first; the rest
// is the same weekly form the house links show. `?house=<id>` picks a
// house up front, but only if it is in the picker's own list. Nothing about a house
// is prefilled here (anyone can open this page, so last week's answers
// and counts stay off it), and the page carries only each house's id,
// number, name and meeting date, and the questions without their
// routes (publicRenderSchema). The submit route saves with the full
// stored schema.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function isSchema(raw: unknown): raw is FormSchema {
  return Boolean(raw && typeof raw === "object" && Array.isArray((raw as FormSchema).steps));
}

export async function MissioPublicWeeklyFeedback({
  db,
  schema,
  house,
}: {
  db: Db;
  schema: unknown;
  /** The raw `?house=` value. Preselected only if it is one of the picker's houses. */
  house?: string | string[] | null;
}) {
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
      // Unused with a picker: the heading takes the chosen house's own
      // meetingDate (worked out per house on the server, as the save does).
      meetingDate=""
      lastAttendance={null}
      initial={{}}
      sentBefore={false}
      schema={publicRenderSchema(isSchema(schema) ? schema : missioWeeklyFeedbackSchema())}
      endpoint={`/api${MISSIO_PUBLIC_FEEDBACK_PATH}/submit`}
      picker={{ houses }}
      // Checked against the same list the picker draws: anything else is
      // dropped, so the form opens with nothing chosen and no error.
      initialHouseId={preselectedHouseId(house, houses)}
    />
  );
}
