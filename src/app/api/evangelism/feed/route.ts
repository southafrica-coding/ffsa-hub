import { EVANGELISM_FEED_POLL_SECONDS, mediaExpiresAt, parseTestimonyIds } from "@/lib/evangelism/contract";
import { asError, guardEvangelism, isGuard, json } from "@/lib/evangelism/http";
import { presentTestimony, type TestimonyRow } from "@/lib/evangelism/present";
import { isEvangelismNotReady } from "@/lib/evangelism/schema-error";
import { aggregateTestimonies, statsWindow } from "@/lib/evangelism/stats";
import { loadAuthorNames, signTestimonyMedia } from "@/lib/evangelism/signed-media";
import {
  STATS_ROW_CAP,
  listPublishedByIds,
  listPublishedFeed,
  listPublishedForStats,
  listRemovalsSince,
  listWithheldSince,
} from "@/services/evangelism";

// GET /api/evangelism/feed?since=<iso>&visible=<id,id>
//
// One poll for the TV.
//   testimonies     — published since the cursor (first call: newest 50, oldest first)
//   refreshed       — stories in `visible` that are still published, with new
//                     read URLs. Signed URLs last 10 minutes, so the screen
//                     sends the ids it is already showing on every poll.
//   removed_ids     — ids that were published and have since been withheld or
//                     deleted, plus any `visible` id that is no longer published.
//                     Apply these after appending testimonies.
//   media_expires_at — when the URLs in this response stop working.
//
// POST /api/evangelism/media/refresh renews URLs without a stats poll.
//
// Transport is polling. A signed-in display account with evangelism.view
// calls this every poll_after_seconds.

const FEED_LIMIT = 50;

async function presentRows(rows: TestimonyRow[], expiresAt: string) {
  const [urls, names] = await Promise.all([
    signTestimonyMedia(rows),
    loadAuthorNames(rows.map((row) => row.author_user_id)),
  ]);
  return rows.map((row) =>
    presentTestimony(row, {
      urls,
      publish: false,
      authorName: names.get(row.author_user_id) ?? null,
      mediaExpiresAt: expiresAt,
    })
  );
}

export async function GET(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, access } = guard;
  if (!access.view) {
    return json({ error: "forbidden", message: "You cannot open the evangelism feed." }, 403);
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  if (since && Number.isNaN(Date.parse(since))) {
    return json({ error: "bad_request", message: "since must be an ISO timestamp." }, 400);
  }
  const visible = parseTestimonyIds(url.searchParams.get("visible"));
  if (!visible.ok) return json({ error: "bad_request", message: visible.message }, 400);

  const window = statsWindow("month");
  const [feed, statsResult, stillUp, withheld, removals] = await Promise.all([
    listPublishedFeed(supabase, { since, limit: FEED_LIMIT }),
    listPublishedForStats(supabase, window),
    listPublishedByIds(supabase, visible.ids),
    since ? listWithheldSince(supabase, since) : Promise.resolve({ data: [], error: null }),
    since ? listRemovalsSince(supabase, since) : Promise.resolve({ data: [], error: null }),
  ]);
  if (feed.error) return asError(feed.error, "Couldn't load the feed.");
  if (statsResult.error) return asError(statsResult.error, "Couldn't load evangelism stats.");
  if (stillUp.error) return asError(stillUp.error, "Couldn't refresh stories already on screen.");
  if (withheld.error) return asError(withheld.error, "Couldn't load stories taken off the screen.");
  // The removals table is proposed. Withheld rows and missing visible ids
  // still tell the screen what to drop if it has not been created yet.
  const removalRows = removals.error && isEvangelismNotReady(removals.error) ? [] : removals.data;
  if (removals.error && !isEvangelismNotReady(removals.error)) {
    return asError(removals.error, "Couldn't load stories taken off the screen.");
  }

  const rows = (since ? (feed.data ?? []) : [...((feed.data ?? []) as TestimonyRow[])].reverse()) as TestimonyRow[];
  const refreshedRows = (stillUp.data ?? []) as TestimonyRow[];
  const expiresAt = mediaExpiresAt();
  const [testimonies, refreshed] = await Promise.all([
    presentRows(rows, expiresAt),
    presentRows(refreshedRows, expiresAt),
  ]);

  const stillPublished = new Set(refreshedRows.map((row) => row.id));
  const removed = new Set<string>();
  for (const id of visible.ids) if (!stillPublished.has(id)) removed.add(id);
  for (const row of (withheld.data ?? []) as Array<{ id: string }>) removed.add(row.id);
  for (const row of (removalRows ?? []) as Array<{ testimony_id: string }>) removed.add(row.testimony_id);

  const last = rows.length > 0 ? rows[rows.length - 1].published_at : since;
  const statRows = statsResult.data ?? [];
  return json({
    transport: "poll",
    poll_after_seconds: EVANGELISM_FEED_POLL_SECONDS,
    server_time: new Date().toISOString(),
    media_expires_at: expiresAt,
    cursor: last,
    testimonies,
    refreshed,
    removed_ids: [...removed],
    stats: aggregateTestimonies(statRows, {
      range: "month",
      from: window.from,
      to: window.to,
      truncated: statRows.length >= STATS_ROW_CAP,
    }),
  });
}
