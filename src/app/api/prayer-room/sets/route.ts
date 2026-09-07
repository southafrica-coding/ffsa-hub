import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSets,
  getOwnedSets,
  getMyRoster,
  getMyInvites,
  getSetById,
  createSet,
  createSeries,
  deleteSeries,
  deleteSeriesSets,
  updateSeriesSets,
  updateSet,
  completeSet,
  cancelSet,
  deleteSet,
} from "@/services/prayer-room";
import { weeklyOccurrenceDates } from "@/lib/bookings/recurrence";
import { sendPrayerRoomInvite } from "@/lib/email/send-prayer-room";

type TeamPick = { user_id: string; role: string };

/** Today in the server's local date terms — the boundary for "remaining". */
function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Seed each set with the up-front team. "invite" creates invited slots the
 * person must accept; "open" creates the same roles as empty slots to be
 * filled later (used for a weekly series that doesn't keep the team each week).
 */
async function applyTeam(
  supabase: AnyClient,
  sets: Array<{ id: string }>,
  team: TeamPick[],
  mode: "invite" | "open",
  invitedBy: string
) {
  if (team.length === 0) return;
  const now = new Date().toISOString();
  for (const set of sets) {
    const rows = team.map((t, i) =>
      mode === "invite"
        ? {
            set_id: set.id,
            role: t.role,
            position: i,
            status: "invited",
            invitee_id: t.user_id,
            invited_by: invitedBy,
            invited_at: now,
          }
        : { set_id: set.id, role: t.role, position: i }
    );
    await supabase.from("prayer_room_set_slots").insert(rows);
  }
}

/** One invite email per team member, referencing the first (or only) occurrence. */
async function emailTeam(
  admin: AnyClient,
  team: TeamPick[],
  ownerId: string,
  when: { setTitle: string; setDate: string; startTime: string; endTime: string }
) {
  if (team.length === 0) return;
  const ids = Array.from(new Set([...team.map((t) => t.user_id), ownerId]));
  const { data: people } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .in("id", ids);
  const list = people ?? [];
  const owner = list.find((p: { id: string }) => p.id === ownerId) ?? {};
  for (const t of team) {
    const invitee = list.find((p: { id: string }) => p.id === t.user_id);
    if (invitee) {
      await sendPrayerRoomInvite({ invitee, owner, role: t.role, ...when });
    }
  }
}

// GET — schedule + "my" views. Reads via the admin client so other people's
// display names resolve (RLS on users is own-row-or-admin); no contact fields.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const admin = createAdminClient();

  let result;
  if (scope === "owned") {
    result = await getOwnedSets(admin, user.id, { upcoming: url.searchParams.get("upcoming") === "true" });
  } else if (scope === "roster") {
    result = await getMyRoster(admin, user.id);
  } else if (scope === "invites") {
    result = await getMyInvites(admin, user.id);
  } else if (url.searchParams.get("id")) {
    result = await getSetById(admin, url.searchParams.get("id")!);
  } else {
    result = await getSets(admin, {
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json(result.data);
}

// POST — create a one-off or weekly-recurring devo set, optionally seeding the
// team up front. (RLS: owner must be self + an active member, or staff.)
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recurrence = body.recurrence === "weekly" ? "weekly" : "none";
  const start_time = body.start_time as string;
  const end_time = body.end_time as string;
  const title = (body.title as string) || null;
  const theme = (body.theme as string) || null;
  const ownerId = (body.owner_id as string) || user.id;
  const team: TeamPick[] = Array.isArray(body.team)
    ? (body.team as TeamPick[]).filter((t) => t && t.user_id && t.role)
    : [];

  if (!start_time || !end_time) {
    return NextResponse.json({ error: "start_time and end_time are required" }, { status: 400 });
  }
  if (end_time <= start_time) {
    return NextResponse.json({ error: "end_time must be after start_time" }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── Weekly recurrence ───────────────────────────────────────────────────
  if (recurrence === "weekly") {
    const weekday = Number(body.weekday);
    const series_start = body.series_start as string;
    const series_end = body.series_end as string;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json({ error: "A day of the week is required" }, { status: 400 });
    }
    if (!series_start || !series_end) {
      return NextResponse.json({ error: "Series start and end dates are required" }, { status: 400 });
    }
    if (series_end < series_start) {
      return NextResponse.json({ error: "Series end must be on or after the start" }, { status: 400 });
    }
    const dates = weeklyOccurrenceDates(series_start, series_end, weekday);
    if (dates.length === 0) {
      return NextResponse.json({ error: "No dates in that range fall on the chosen day" }, { status: 400 });
    }

    const keepTeam = body.keep_team !== false; // default true
    const { data: series, error: serr } = await createSeries(supabase, {
      owner_id: ownerId,
      created_by: user.id,
      weekday,
      start_time,
      end_time,
      title,
      theme,
      series_start,
      series_end,
      keep_team: keepTeam,
    });
    if (serr || !series) {
      return NextResponse.json({ error: serr?.message ?? "Failed to create series" }, { status: 403 });
    }

    const created: Array<{ id: string; set_date: string }> = [];
    for (const d of dates) {
      const { data: set, error } = await createSet(supabase, {
        owner_id: ownerId,
        created_by: user.id,
        set_date: d,
        start_time,
        end_time,
        title,
        theme,
        series_id: series.id,
      });
      if (error || !set) {
        // Best-effort rollback so we don't leave a half-built series behind.
        for (const c of created) await deleteSet(supabase, c.id);
        await deleteSeries(supabase, series.id);
        return NextResponse.json({ error: error?.message ?? "Failed to create occurrences" }, { status: 403 });
      }
      created.push(set);
    }

    // keep_team → invite the team into every week; otherwise repeat the roles as open slots.
    await applyTeam(supabase, created, team, keepTeam ? "invite" : "open", user.id);
    if (keepTeam) {
      await emailTeam(admin, team, ownerId, {
        setTitle: title ?? "Devo set",
        setDate: created[0].set_date,
        startTime: start_time,
        endTime: end_time,
      });
    }

    // set_date so the caller can move the schedule to the week the series
    // actually starts in — a weekly series beginning on the first matching
    // weekday ON OR AFTER "runs from" often lands in NEXT week, and the wall
    // stays where it was, which reads as "nothing was created".
    return NextResponse.json({
      id: created[0].id,
      set_date: created[0].set_date,
      count: created.length,
      seriesId: series.id,
    });
  }

  // ── One-off ─────────────────────────────────────────────────────────────
  const set_date = body.set_date as string;
  if (!set_date) {
    return NextResponse.json({ error: "set_date is required" }, { status: 400 });
  }

  const { data: set, error } = await createSet(supabase, {
    owner_id: ownerId,
    created_by: user.id,
    set_date,
    start_time,
    end_time,
    title,
    theme,
    scripture: (body.scripture as string) ?? null,
    prayer_focus: (body.prayer_focus as string) ?? null,
    setlist: (body.setlist as string) ?? null,
  });
  if (error || !set) {
    return NextResponse.json({ error: error?.message ?? "Failed to create set" }, { status: 403 });
  }

  await applyTeam(supabase, [set], team, "invite", user.id);
  await emailTeam(admin, team, ownerId, {
    setTitle: title ?? "Devo set",
    setDate: set_date,
    startTime: start_time,
    endTime: end_time,
  });

  return NextResponse.json({ id: set.id, set_date, count: 1 });
}

// PUT — update / complete / cancel a set (RLS: owner or staff).
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id, action, series_id, scope } = body as {
    id?: string;
    action?: string;
    series_id?: string;
    scope?: string;
  };

  // Edit a whole weekly series at once. "remaining" (the default) leaves
  // occurrences that already happened alone so a mid-series retime doesn't
  // rewrite history people were already rostered into.
  if (series_id) {
    const fields: Record<string, unknown> = {};
    for (const k of ["title", "theme", "scripture", "prayer_focus", "setlist", "start_time", "end_time", "owner_id"]) {
      if (k in body) fields[k] = body[k];
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const result = await updateSeriesSets(
      supabase,
      series_id,
      fields,
      scope === "all" ? undefined : todayISO()
    );
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 403 });
    return NextResponse.json(result.data);
  }

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  let result;
  if (action === "complete") {
    result = await completeSet(supabase, id);
  } else if (action === "cancel") {
    result = await cancelSet(supabase, id);
  } else {
    const fields: Record<string, unknown> = {};
    for (const k of ["title", "theme", "scripture", "prayer_focus", "setlist", "set_date", "start_time", "end_time", "owner_id"]) {
      if (k in body) fields[k] = body[k];
    }
    result = await updateSet(supabase, id, fields);
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 403 });
  return NextResponse.json(result.data);
}

// DELETE — remove a set (RLS: owner or staff).
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const params = new URL(request.url).searchParams;

  // Bulk delete a weekly series. Defaults to the remaining occurrences so
  // clearing a series that is halfway through doesn't erase the sets that
  // already ran; ?scope=all removes every occurrence.
  const seriesId = params.get("seriesId");
  if (seriesId) {
    const scope = params.get("scope");
    const { data, error } = await deleteSeriesSets(
      supabase,
      seriesId,
      scope === "all" ? undefined : todayISO()
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, ...data });
  }

  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id or seriesId is required" }, { status: 400 });

  const { error } = await deleteSet(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
