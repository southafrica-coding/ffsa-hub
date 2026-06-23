import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetById, createSeries, createSet, updateSet, insertSlotRows } from "@/services/prayer-room";
import { weeklyOccurrenceDates } from "@/lib/bookings/recurrence";

type SourceSlot = {
  role: string;
  position: number | null;
  required_label_id: string | null;
  filled_user_id: string | null;
  invitee_id: string | null;
};

// POST — turn an existing one-off set into a weekly series. Creates the series,
// links this set in as the first occurrence, and generates the remaining weekly
// sets through series_end. keep_team carries this set's roster forward as
// invited slots; otherwise the same roles repeat as open slots.
// (RLS: owner of the set or staff.)
export async function POST(request: Request, { params }: { params: Promise<{ setId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { setId } = await params;
  const body = await request.json().catch(() => ({}));
  const series_end = (body.series_end as string) || "";
  const keepTeam = body.keep_team !== false; // default true

  if (!series_end) {
    return NextResponse.json({ error: "An end date is required" }, { status: 400 });
  }

  // Read the source set (admin client so other people's roster names resolve).
  const admin = createAdminClient();
  const { data: set, error: setErr } = await getSetById(admin, setId);
  if (setErr || !set) return NextResponse.json({ error: "Set not found" }, { status: 404 });
  if (set.series_id) {
    return NextResponse.json({ error: "This set is already part of a weekly series" }, { status: 400 });
  }
  if (set.status !== "scheduled") {
    return NextResponse.json({ error: "Only scheduled sets can be made recurring" }, { status: 400 });
  }
  if (series_end < set.set_date) {
    return NextResponse.json({ error: "End date must be on or after this set's date" }, { status: 400 });
  }

  const weekday = new Date(set.set_date + "T00:00:00Z").getUTCDay();
  const ownerId = (set.owner_id as string) || user.id;

  // 1. Series row.
  const { data: series, error: serr } = await createSeries(supabase, {
    owner_id: ownerId,
    created_by: user.id,
    weekday,
    start_time: set.start_time,
    end_time: set.end_time,
    title: set.title ?? null,
    theme: set.theme ?? null,
    series_start: set.set_date,
    series_end,
    keep_team: keepTeam,
  });
  if (serr || !series) {
    return NextResponse.json({ error: serr?.message ?? "Failed to create series" }, { status: 403 });
  }

  // 2. Link this set in as the first occurrence.
  await updateSet(supabase, setId, { series_id: series.id });

  // 3. Replicate this set's roster shape onto each new week.
  const sourceSlots: SourceSlot[] = ((set.slots ?? []) as SourceSlot[])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // 4. Future occurrences — every matching weekday after this set's own date.
  const dates = weeklyOccurrenceDates(set.set_date, series_end, weekday).filter((d) => d !== set.set_date);
  const now = new Date().toISOString();
  let created = 0;

  for (const d of dates) {
    const { data: ns, error } = await createSet(supabase, {
      owner_id: ownerId,
      created_by: user.id,
      set_date: d,
      start_time: set.start_time,
      end_time: set.end_time,
      title: set.title ?? null,
      theme: set.theme ?? null,
      series_id: series.id,
    });
    if (error || !ns) continue; // best-effort; skip a week that fails rather than abort
    created += 1;

    if (sourceSlots.length > 0) {
      const rows = sourceSlots.map((s, i) => {
        const person = keepTeam ? s.filled_user_id ?? s.invitee_id : null;
        return person
          ? {
              set_id: ns.id,
              role: s.role,
              position: i,
              required_label_id: s.required_label_id ?? null,
              status: "invited",
              invitee_id: person,
              invited_by: user.id,
              invited_at: now,
            }
          : { set_id: ns.id, role: s.role, position: i, required_label_id: s.required_label_id ?? null };
      });
      await insertSlotRows(supabase, rows);
    }
  }

  return NextResponse.json({ ok: true, seriesId: series.id, created });
}
