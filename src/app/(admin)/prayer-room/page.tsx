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

  const [isStaff, isEvaluator, canSeeDirectory, memberRes] = await Promise.all([
    isPrayerRoomStaff(supabase, user.id),
    isPrayerRoomEvaluator(supabase, user.id),
    canViewDirectory(supabase, user.id),
    getMemberFlags(supabase, user.id),
  ]);

  const member = memberRes.data as { status: string } | null;
  const isMember = member?.status === "active";

  const pendingCount = isStaff ? await getPendingApplicationCount(supabase) : 0;

  return (
    <PrayerRoomClient
      userId={user.id}
      isStaff={isStaff}
      isMember={isMember}
      isEvaluator={isEvaluator}
      canViewDirectory={canSeeDirectory}
      pendingCount={pendingCount}
    />
  );
}
