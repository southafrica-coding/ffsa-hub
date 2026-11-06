import { mediaExpiresAt, parseTestimonyIds } from "@/lib/evangelism/contract";
import { asError, guardEvangelism, isGuard, json, readBody } from "@/lib/evangelism/http";
import { presentTestimony, type TestimonyRow } from "@/lib/evangelism/present";
import { loadAuthorNames, signTestimonyMedia } from "@/lib/evangelism/signed-media";
import { listPublishedByIds } from "@/services/evangelism";

// POST /api/evangelism/media/refresh  { ids: string[] }
//
// New signed read URLs for stories the TV is already showing. Feed polls
// also accept ?visible=, which does the same thing beside new stories.
// Ids that are no longer published come back in removed_ids.

export async function POST(request: Request) {
  const guard = await guardEvangelism();
  if (isGuard(guard)) return guard.response;
  const { supabase, access } = guard;
  if (!access.view) {
    return json({ error: "forbidden", message: "You cannot refresh testimony media." }, 403);
  }

  const body = (await readBody(request)) as { ids?: unknown } | undefined;
  const ids = parseTestimonyIds(body?.ids);
  if (!ids.ok) return json({ error: "bad_request", message: ids.message }, 400);

  const listed = await listPublishedByIds(supabase, ids.ids);
  if (listed.error) return asError(listed.error, "Couldn't refresh those stories.");
  const rows = (listed.data ?? []) as TestimonyRow[];
  const found = new Set(rows.map((row) => row.id));
  const expiresAt = mediaExpiresAt();
  const [urls, names] = await Promise.all([
    signTestimonyMedia(rows),
    loadAuthorNames(rows.map((row) => row.author_user_id)),
  ]);

  return json({
    media_expires_at: expiresAt,
    testimonies: rows.map((row) =>
      presentTestimony(row, {
        urls,
        publish: false,
        authorName: names.get(row.author_user_id) ?? null,
        mediaExpiresAt: expiresAt,
      })
    ),
    removed_ids: ids.ids.filter((id) => !found.has(id)),
  });
}
