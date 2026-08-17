import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPersonProfile } from "@/services/prayer-room-people";
import { isPrayerRoomStaff, isApprovedMember, canViewDirectory } from "@/lib/auth/prayer-room-access";

/**
 * One person, for frame 11a.
 *
 * The caller's client is handed to the service so evaluation notes are read
 * under their own policies — a set lead gets the seat states and no notes,
 * which is what frame 12b's third card promises.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const trusted =
    user.id === userId ||
    (await isPrayerRoomStaff(supabase, user.id)) ||
    (await isApprovedMember(supabase, user.id)) ||
    (await canViewDirectory(supabase, user.id));
  if (!trusted) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const profile = await getPersonProfile(createAdminClient(), supabase, userId);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(profile);
}
