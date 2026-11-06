import { EVANGELISM_FEED_POLL_SECONDS } from "@/lib/evangelism/contract";
import { asError, guardEvangelism, isGuard, json } from "@/lib/evangelism/http";
import { presentTestimony, type TestimonyRow } from "@/lib/evangelism/present";
import { aggregateTestimonies, statsWindow } from "@/lib/evangelism/stats";
import { loadAuthorNames, signTestimonyMedia } from "@/lib/evangelism/signed-media";
import { STATS_ROW_CAP, listPublishedFeed, listPublishedForStats } from "@/services/evangelism";

// GET /api/evangelism/feed?since=<iso>
//
// One poll for the TV. Returns published stories newer than `since` (oldest
// first, so the screen can append) plus this month's base stats.
//
// Transport is polling on purpose. The hub does not subscribe to Supabase
// Realtime anywhere. A signed-in display account with evangelism.view calls
// this every poll_after_seconds. Hub Data can add a postgres_changes channel
// later; this response stays the payload either way.

const FEED_LIMIT = 50;

export async function GET(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, access } = guard;
  if (!access.view) {
    return json({ error: "forbidden", message: "You cannot open the evangelism feed." }, 403);
  }

  const since = new URL(request.url).searchParams.get("since");
  if (since && Number.isNaN(Date.parse(since))) {
    return json({ error: "bad_request", message: "since must be an ISO timestamp." }, 400);
  }

  const window = statsWindow("month");
  const [feed, statsResult] = await Promise.all([
    listPublishedFeed(supabase, { since, limit: FEED_LIMIT }),
    listPublishedForStats(supabase, window),
  ]);
  if (feed.error) return asError(feed.error, "Couldn't load the feed.");
  if (statsResult.error) return asError(statsResult.error, "Couldn't load evangelism stats.");

  const rows = (since ? (feed.data ?? []) : [...((feed.data ?? []) as TestimonyRow[])].reverse()) as TestimonyRow[];
  const [urls, names] = await Promise.all([
    signTestimonyMedia(rows),
    loadAuthorNames(rows.map((row) => row.author_user_id)),
  ]);
  const testimonies = rows.map((row) =>
    presentTestimony(row, {
      urls,
      publish: false,
      authorName: names.get(row.author_user_id) ?? null,
    })
  );
  const last = rows.length > 0 ? rows[rows.length - 1].published_at : since;

  const statRows = statsResult.data ?? [];
  return json({
    transport: "poll",
    poll_after_seconds: EVANGELISM_FEED_POLL_SECONDS,
    server_time: new Date().toISOString(),
    cursor: last,
    testimonies,
    stats: aggregateTestimonies(statRows, {
      range: "month",
      from: window.from,
      to: window.to,
      truncated: statRows.length >= STATS_ROW_CAP,
    }),
  });
}
