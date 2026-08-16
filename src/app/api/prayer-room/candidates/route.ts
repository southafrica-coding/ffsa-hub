import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPrayerRoomStaff, isApprovedMember } from "@/lib/auth/prayer-room-access";
import { listSeatCandidates, listSeatTypes } from "@/services/prayer-room-seats";

/**
 * Who could take a seat, ordered the way design rule 3 asks: signed off first,
 * then least-loaded. Also returns whether each person already holds something
 * that overlaps, so the picker can say "On Selah at 09:30" rather than letting
 * the database refuse the fill after the fact.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Same audience as the directory: staff and approved members. Who is signed
  // off for what is team information, not public.
  const trusted =
    (await isPrayerRoomStaff(supabase, user.id)) || (await isApprovedMember(supabase, user.id));
  if (!trusted) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const url = new URL(request.url);
  const seatTypeId = url.searchParams.get("seat");
  if (!seatTypeId) {
    return NextResponse.json({ error: "seat is required" }, { status: 400 });
  }

  const [candidates, seatTypes] = await Promise.all([
    listSeatCandidates(supabase, { seatTypeId, setId: url.searchParams.get("setId") }),
    listSeatTypes(supabase),
  ]);

  return NextResponse.json({
    candidates,
    seat: seatTypes.find((s) => s.id === seatTypeId) ?? null,
  });
}
