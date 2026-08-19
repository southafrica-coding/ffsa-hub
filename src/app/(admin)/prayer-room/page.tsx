import { createClient } from "@/lib/supabase/server";
import { isPrayerRoomStaff, isPrayerRoomEvaluator, canViewDirectory } from "@/lib/auth/prayer-room-access";
import { getPendingApplicationCount } from "@/services/prayer-room";
import { getMemberFlags } from "@/services/prayer-room-members";
import PrayerRoomClient from "./prayer-room-client";

export default async function PrayerRoomPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [isStaff, isEvaluator, canSeeDirectory, memberRes, meRes, qualRes] = await Promise.all([
    isPrayerRoomStaff(supabase, user.id),
    isPrayerRoomEvaluator(supabase, user.id),
    canViewDirectory(supabase, user.id),
    getMemberFlags(supabase, user.id),
    // Frame 11a prints "Recorded as <name>" under the sign-off button, so the
    // evaluator's own name has to reach the client.
    supabase.from("users").select("first_name, last_name, preferred_name").eq("id", user.id).maybeSingle(),
    // "In the catalogue" = signed off for at least one seat (migration 181).
    // It is what lets someone put a set on the wall without asking anyone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("prayer_room_qualifications")
      .select("seat_type_id")
      .eq("user_id", user.id)
      .eq("state", "signed_off")
      .limit(1),
  ]);

  const me = meRes.data as { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  const userName =
    [me?.preferred_name || me?.first_name, me?.last_name].filter(Boolean).join(" ") || "You";

  const member = memberRes.data as { status: string } | null;
  const isMember = member?.status === "active";

  const inCatalogue = ((qualRes.data as unknown[] | null) ?? []).length > 0;

  const pendingCount = isStaff ? await getPendingApplicationCount(supabase) : 0;

  return (
    <PrayerRoomClient
      userId={user.id}
      userName={userName}
      isStaff={isStaff}
      isMember={isMember}
      inCatalogue={inCatalogue}
      isEvaluator={isEvaluator}
      canViewDirectory={canSeeDirectory}
      pendingCount={pendingCount}
    />
  );
}
