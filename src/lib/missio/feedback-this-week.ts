import "server-only";
import { buildSundayResults, weekOf, type FeedbackRow, type ResultsHouse } from "./sunday-results";
import { feedbackSunday } from "./weekly-feedback";

// ============================================================
// Missio Home — which houses haven't sent this week
// ============================================================
// The same week and the same source as /missio-feedback: the week
// ending on feedbackSunday(null), read from missio_house_feedback on
// the viewer's own client (RLS 339 is the wall), rolled up by
// buildSundayResults. Only id, number and name of the missing houses
// leave, with the counts; no answers.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type MissingHouse = { id: string; number: number; name: string | null };

export type FeedbackThisWeek = {
  /** YYYY-MM-DD: the Sunday that ends the week. */
  sunday: string;
  total: number;
  sentCount: number;
  missing: MissingHouse[];
};

export type ThisWeekScope = { mode: "all" } | { mode: "houses"; ids: readonly string[] };

export async function feedbackThisWeek(
  supabase: Client,
  orgId: string,
  scope: ThisWeekScope,
  now = new Date()
): Promise<{ ok: true; data: FeedbackThisWeek } | { ok: false }> {
  const sunday = feedbackSunday(null, now);
  const { from, to } = weekOf(sunday);

  let houseQuery = supabase.from("house_churches").select("id, number, name").eq("org_id", orgId);
  if (scope.mode === "houses") houseQuery = houseQuery.in("id", [...scope.ids]);
  const houseRes = await houseQuery.order("number", { ascending: true });
  if (houseRes.error) return { ok: false };
  const houses = ((houseRes.data ?? []) as Record<string, unknown>[]).map(
    (row): ResultsHouse => ({
      id: String(row.id),
      number: Number(row.number),
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
    })
  );

  let rows: FeedbackRow[] = [];
  if (houses.length > 0) {
    // Only what "sent or not" needs: which house, which meeting.
    const rowRes = await supabase
      .from("missio_house_feedback")
      .select("house_church_id, meeting_date")
      .in(
        "house_church_id",
        houses.map((h) => h.id)
      )
      .gte("meeting_date", from)
      .lte("meeting_date", to);
    if (rowRes.error) return { ok: false };
    rows = (rowRes.data ?? []) as FeedbackRow[];
  }

  const results = buildSundayResults(houses, rows, sunday);
  const missing = results.houses
    .filter((line) => line.state === "missing")
    .map((line) => ({ id: line.id, number: line.number, name: line.name }));
  return { ok: true, data: { sunday: results.sunday, total: results.total, sentCount: results.sentCount, missing } };
}
