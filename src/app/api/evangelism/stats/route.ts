import { asError, guardEvangelism, isGuard, json } from "@/lib/evangelism/http";
import { aggregateTestimonies, parseStatsRange, statsWindow } from "@/lib/evangelism/stats";
import { STATS_ROW_CAP, listPublishedForStats } from "@/services/evangelism";

// GET /api/evangelism/stats?range=week|month|quarter|year|all
//
// Base-wide totals of published testimonies. Counts use occurred_on in
// Africa/Johannesburg, not when the row was typed in. Drafts never count.

export async function GET(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, access } = guard;
  if (!access.view) {
    return json({ error: "forbidden", message: "You cannot view evangelism stats." }, 403);
  }

  const range = parseStatsRange(new URL(request.url).searchParams.get("range"));
  const window = statsWindow(range);
  const { data, error } = await listPublishedForStats(supabase, window);
  if (error) return asError(error, "Couldn't load evangelism stats.");

  const rows = data ?? [];
  return json({
    stats: aggregateTestimonies(rows, {
      range,
      from: window.from,
      to: window.to,
      truncated: rows.length >= STATS_ROW_CAP,
    }),
  });
}
