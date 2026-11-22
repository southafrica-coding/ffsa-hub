import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SundayResultsView } from "@/components/missio/weekly/results";
import { GuideStatus } from "@/components/missio/weekly/surface";
import { hubFormsNudgeEnabled, hubFormsSlackEnabled } from "@/lib/forms/flags";
import { houseReadAccess, type HouseScope } from "@/lib/missio/house-churches";
import { buildSundayResults, weekOf, type FeedbackRow, type ResultsHouse } from "@/lib/missio/sunday-results";
import { feedbackSunday } from "@/lib/missio/weekly-feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "This Sunday · MissioSA" },
  robots: { index: false, follow: false },
};

// /missio-feedback — Sunday results (F4). Pastors see every house;
// a coach sees the houses they coach. Reads run on the viewer's own
// client, so RLS (339) is the wall. ?date=YYYY-MM-DD shows the week
// that ends on that day.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function SundayResultsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const access = await houseReadAccess();
  if ("response" in access) {
    if (access.response.status === 401) redirect("/login");
    return <Forbidden />;
  }
  const pastor = access.auth.roles.includes("pastor");
  // Coaches: only the houses they coach (editScope), not ones they lead.
  const scope: HouseScope = pastor ? { mode: "all" } : access.editScope;
  if (scope.mode === "houses" && scope.ids.length === 0) return <Forbidden />;

  const { date } = await searchParams;
  const sunday = date && ISO.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ? date : feedbackSunday(null);
  const { from, to } = weekOf(sunday);

  let houseQuery = access.auth.supabase.from("house_churches").select("id, number, name").eq("org_id", access.auth.orgId);
  if (scope.mode === "houses") houseQuery = houseQuery.in("id", [...scope.ids]);
  const houseRes = await houseQuery.order("number", { ascending: true });
  const houses = (houseRes.data ?? []) as ResultsHouse[];

  let rows: FeedbackRow[] = [];
  if (houses.length > 0) {
    const rowRes = await access.auth.supabase
      .from("missio_house_feedback")
      .select("*")
      .in("house_church_id", houses.map((h) => h.id))
      .gte("meeting_date", from)
      .lte("meeting_date", to);
    rows = (rowRes.error ? [] : rowRes.data ?? []) as FeedbackRow[];
  }

  const results = buildSundayResults(houses, rows, sunday, { slackOn: hubFormsSlackEnabled() });
  return (
    <SundayResultsView
      results={results}
      // Only pastors may nudge, and only with the nudge switched on.
      nudge={{ enabled: pastor && hubFormsNudgeEnabled(), endpoint: "/api/missio/feedback/nudge" }}
      navHref="/missio/house-churches/feedback"
    />
  );
}

function Forbidden() {
  return (
    <GuideStatus
      eyebrow="Sunday results"
      title="For pastors and coaches"
      body="Sunday results are for the pastors and the house coaches. Your own house’s form is on your house page."
      state="forbidden"
      action={{ label: "Your houses", href: "/missio/house-churches" }}
    />
  );
}
