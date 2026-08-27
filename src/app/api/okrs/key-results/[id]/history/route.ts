import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { hydrateUserNames, listCheckins, listKeyResultEvents } from "@/services/okrs";
import type { OkrCheckin, OkrEvent, OkrHistoryEntry } from "@/types/okrs";

type Params = { params: Promise<{ id: string }> };

/** Matches the trigger's own cap — see the note on truncation below. */
const LIMIT = 100;

/**
 * One key result's full story: progress check-ins and recorded edits, merged
 * into a single stream, newest first.
 *
 * The two are kept apart in the database on purpose — a check-in is a
 * deliberate statement someone wrote, an edit is a fact the database observed
 * — but they answer the same question, so they are merged here rather than in
 * the component, which then has one sorted array to render.
 */
export async function GET(_request: Request, { params }: Params) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  // Both reads use the CALLER's client, so RLS decides what they may see —
  // okr_events reuses the same can_view_okr_key_result helper the key result
  // itself does, so the history can never be more visible than its subject.
  const [checkinsRes, eventsRes] = await Promise.all([
    listCheckins(supabase, id),
    listKeyResultEvents(supabase, id, LIMIT),
  ]);

  if (checkinsRes.error) {
    return NextResponse.json({ error: checkinsRes.error.message }, { status: 500 });
  }
  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 });
  }

  const checkins = (checkinsRes.data ?? []) as OkrCheckin[];
  const events = (eventsRes.data ?? []) as OkrEvent[];

  // ...then resolve only the NAMES with the admin client, in one call across
  // both streams. public.users is own-row-or-admin, so an embedded join would
  // hand a ministry leader a list of nulls and every author would be "Unknown".
  const names = await hydrateUserNames([
    ...checkins.map((c) => c.author_id),
    ...events.map((e) => e.actor_id).filter((a): a is string => !!a),
  ]);

  const entries: OkrHistoryEntry[] = [
    ...checkins.map((c) => ({
      kind: "checkin" as const,
      // created_at, not checkin_on: a back-dated check-in still happened when
      // it happened, and this is the same ordering the last_checkin_at trigger
      // uses. checkin_on is what gets DISPLAYED.
      at: c.created_at,
      author: names[c.author_id] ?? null,
      checkin: c,
    })),
    ...events.map((e) => ({
      kind: "event" as const,
      at: e.created_at,
      author: e.actor_id ? names[e.actor_id] ?? null : null,
      event: e,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Say so rather than truncating silently: a key result checked in weekly for
  // a year runs past the cap, and a timeline that quietly stops is worse than
  // one that admits where it ends.
  const truncated = events.length >= LIMIT;

  return NextResponse.json({ entries, truncated });
}
