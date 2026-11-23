import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WeeklyFeedbackFill } from "@/components/missio/weekly/fill";
import { GuideStatus } from "@/components/missio/weekly/surface";
import { houseInScope, houseReadAccess, isUuid } from "@/lib/missio/house-churches";
import { loadWeeklyFillView, loadWeeklyHouse } from "@/lib/missio/weekly-feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Weekly feedback · MissioSA" },
  robots: { index: false, follow: false },
};

// /missio-feedback/:houseId — the weekly form for a signed-in leader
// (or the house's coach, or a pastor), opened from the house page. The
// house comes from the URL and is checked against the viewer's houses;
// the same save path as the house link runs it (F4).
//
// Outside /missio on purpose: the form is full width on a phone with the
// wordmark bar (board M4a), not inside the Missio frame.

export default async function SignedInFeedbackPage({ params }: { params: Promise<{ houseId: string }> }) {
  const { houseId } = await params;
  const access = await houseReadAccess();
  if ("response" in access) {
    if (access.response.status === 401) redirect("/login");
    return (
      <GuideStatus
        eyebrow="Weekly feedback"
        title="Not your house"
        body="Only the house’s leaders, its coach and the pastors can fill this in."
        state="forbidden"
      />
    );
  }
  if (!isUuid(houseId) || !houseInScope(access.scope, houseId)) {
    return (
      <GuideStatus
        eyebrow="Weekly feedback"
        title="Not your house"
        body="Only the house’s leaders, its coach and the pastors can fill this in."
        state="forbidden"
        action={{ label: "Your houses", href: "/missio/house-churches" }}
      />
    );
  }
  // RLS (331/338) decides whether this viewer can read the house.
  const house = await loadWeeklyHouse(access.auth.supabase, houseId);
  if (!house || house.org_id !== access.auth.orgId) {
    return <GuideStatus eyebrow="Weekly feedback" title="House not found" body="Open it again from your house page." state="not_found" />;
  }
  const view = await loadWeeklyFillView(access.auth.supabase, house);
  const houseHref = `/missio/house-churches/${house.id}`;
  if (!view.open) {
    return (
      <GuideStatus
        eyebrow={`House ${house.number} · Weekly feedback`}
        title={
          <>
            Opens <em>soon.</em>
          </>
        }
        body="Weekly feedback isn’t open yet. The pastors will let you know when it is."
        nav={{ label: `House ${house.number}`, href: houseHref }}
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
      endpoint={`/api/missio/house-churches/${house.id}/feedback/weekly`}
      houseHref={houseHref}
    />
  );
}
