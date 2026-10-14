import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import {
  getBookingSuggestions,
  applyBookingSuggestion,
  dismissBookingSuggestion,
  keepChangedBlockout,
  PRAYER_ROOM_VENUE_SLUG,
} from "@/services/prayer-room-booking-suggestions";

async function staffUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await isPrayerRoomStaff(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { supabase, user };
}

// GET — Space Bookings of the prayer room that displace devo sets and still
// need a block-out, plus applied block-outs whose booking has since changed.
export async function GET() {
  const auth = await staffUser();
  if ("error" in auth) return auth.error;
  try {
    const admin = createAdminClient();
    const [result, venuesRes] = await Promise.all([
      getBookingSuggestions(admin),
      // Quick-picks for "where are sets moving to?" — every other active space.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any)
        .from("venues")
        .select("name, slug")
        .eq("is_active", true)
        .neq("slug", PRAYER_ROOM_VENUE_SLUG)
        .order("sort_order"),
    ]);
    const venues = ((venuesRes.data ?? []) as { name: string }[]).map((v) => v.name);
    return NextResponse.json({ ...result, venues });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// POST — act on a suggestion:
//   { action: "apply",   bookingIds, relocation_note, reason? }
//   { action: "dismiss", bookingIds }
//   { action: "keep",    blockoutId }  (a block-out whose booking changed)
export async function POST(request: Request) {
  const auth = await staffUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;
  const admin = createAdminClient();

  const body = await request.json().catch(() => ({}));
  const bookingIds = Array.isArray(body.bookingIds)
    ? (body.bookingIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  if (body.action === "apply") {
    if (bookingIds.length === 0) return NextResponse.json({ error: "bookingIds is required" }, { status: 400 });
    const result = await applyBookingSuggestion(supabase, admin, user.id, {
      bookingIds,
      relocationNote: (body.relocation_note as string)?.trim() || null,
      reason: (body.reason as string)?.trim() || null,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === "dismiss") {
    if (bookingIds.length === 0) return NextResponse.json({ error: "bookingIds is required" }, { status: 400 });
    const result = await dismissBookingSuggestion(supabase, admin, user.id, bookingIds);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.action === "keep") {
    if (typeof body.blockoutId !== "string") return NextResponse.json({ error: "blockoutId is required" }, { status: 400 });
    const result = await keepChangedBlockout(supabase, admin, body.blockoutId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
