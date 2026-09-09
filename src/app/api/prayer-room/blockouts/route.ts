import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBlockouts,
  createBlockout,
  deleteBlockout,
  getSetsInWindow,
  stampRelocation,
} from "@/services/prayer-room";
import {
  notifyPrayerRoomBlockout,
  buildBlockoutMessage,
} from "@/lib/slack/prayer-room";
import { sendBroadcast } from "@/lib/slack/broadcast";

type OwnerName = { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
function ownerName(o: OwnerName): string | null {
  if (!o) return null;
  const name = `${o.first_name || ""} ${o.last_name || ""}`.trim();
  return name || null;
}
function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// GET — list upcoming block-outs (read by all authenticated; surfaced in Manage).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  // ?all=true → everything; ?from=&to= → a calendar range; default → today onward.
  const opts = sp.get("all") === "true" ? undefined : from || to ? { from, to } : { from: todayISO() };
  const { data, error } = await getBlockouts(supabase, opts);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create a block-out, relocate overlapping sets, announce on Slack
// (RLS: staff only — createBlockout fails otherwise).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const block_date = body.block_date as string;
  // Multi-day block-outs span block_date → end_date; a single day omits end_date.
  const end_date = (body.end_date as string) || block_date;
  // All-day block-outs (whole day / week / range) send no times → NULL window.
  const all_day = body.all_day === true;
  const start_time = all_day ? null : (body.start_time as string) || null;
  const end_time = all_day ? null : (body.end_time as string) || null;
  const reason = (body.reason as string)?.trim() || null;
  const relocation_note = (body.relocation_note as string)?.trim() || null;

  if (!block_date) {
    return NextResponse.json({ error: "A date is required" }, { status: 400 });
  }
  if (end_date < block_date) {
    return NextResponse.json({ error: "End date must be on or after the start date" }, { status: 400 });
  }
  if (!all_day) {
    if (!start_time || !end_time) {
      return NextResponse.json({ error: "Start time and end time are required for a timed block-out" }, { status: 400 });
    }
    if (end_time <= start_time) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }
  }

  const { data: blockout, error } = await createBlockout(supabase, {
    block_date,
    end_date,
    start_time,
    end_time,
    reason,
    relocation_note,
    created_by: user.id,
  });
  if (error || !blockout) {
    return NextResponse.json({ error: error?.message ?? "Failed to create block-out" }, { status: 403 });
  }

  // Find + relocate the scheduled sets caught across the whole span.
  const admin = createAdminClient();
  const { data: sets } = await getSetsInWindow(admin, block_date, end_date, start_time, end_time);
  const affected = (sets ?? []) as Array<{
    id: string;
    title: string | null;
    theme: string | null;
    set_date: string;
    start_time: string;
    end_time: string;
    owner: OwnerName;
  }>;

  if (affected.length > 0) {
    await stampRelocation(supabase, affected.map((s) => s.id), relocation_note);
  }

  // Announce on the dedicated prayer-room Slack channel; relay the outcome so
  // the UI can say why it did / didn't post (not configured, bot not in channel…).
  const blockoutMessage = buildBlockoutMessage({
    blockDate: block_date,
    endDate: end_date,
    startTime: start_time,
    endTime: end_time,
    reason,
    relocationNote: relocation_note,
    affected: affected.map((s) => ({
      title: s.title || s.theme || "Devo set",
      date: s.set_date,
      startTime: s.start_time,
      endTime: s.end_time,
      owner: ownerName(s.owner),
    })),
  });

  const slack = await notifyPrayerRoomBlockout({
    blockDate: block_date,
    endDate: end_date,
    startTime: start_time,
    endTime: end_time,
    reason,
    relocationNote: relocation_note,
    affected: affected.map((s) => ({
      title: s.title || s.theme || "Devo set",
      date: s.set_date,
      startTime: s.start_time,
      endTime: s.end_time,
      owner: ownerName(s.owner),
    })),
  });

  // …and DM every person individually. A block-out moves other
  // people's devo sets, so everyone needs it — and the channel post
  // alone relies on them noticing it. Fire-and-forget: delivery is
  // paced across ~60 DMs to stay inside Slack's rate limits, and the
  // block-out itself is already saved, so nothing here may block or
  // fail the response.
  void sendBroadcast({
    type: "prayer_room_blockout",
    title: blockoutMessage.title,
    blocks: blockoutMessage.blocks,
    body: blockoutMessage.body,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com"}/prayer-room`,
    actorUserId: user.id,
  }).catch((err) => {
    console.error("[prayer-room/blockouts] broadcast failed", err);
  });

  return NextResponse.json({ ok: true, blockout, affected: affected.length, slack });
}

// DELETE — remove a block-out entry (RLS: staff only). Leaves any relocation
// notes already stamped on sets in place; a manager can clear those per set.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await deleteBlockout(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
