import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listRoster, listSeatTypesFull } from "@/services/prayer-room-people";
import { isPrayerRoomStaff, isApprovedMember, canViewDirectory } from "@/lib/auth/prayer-room-access";

/**
 * The People tab (frame 10a): everyone who has been evaluated, what they are
 * signed off for, how much they are carrying and where they are next.
 *
 * Same audience as the directory it replaces — staff, approved members and
 * baseline staff. Who is signed off for what is team information, not public.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const trusted =
    (await isPrayerRoomStaff(supabase, user.id)) ||
    (await isApprovedMember(supabase, user.id)) ||
    (await canViewDirectory(supabase, user.id));
  if (!trusted) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const admin = createAdminClient();
  const status = new URL(request.url).searchParams.get("status") ?? "active";

  const [roster, seatTypes] = await Promise.all([
    listRoster(admin, { status }),
    listSeatTypesFull(admin),
  ]);

  return NextResponse.json({ roster, seatTypes });
}
