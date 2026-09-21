import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewStaffCard } from "@/lib/auth/check-cv-access";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { getCardOwner, listCvEntries } from "@/services/staff-cv";
import { StaffCvCard, type CvEntry } from "@/components/profile/staff-cv-card";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Masthead } from "@/components/ffsa";

function nameOf(u: { first_name?: string | null; last_name?: string | null; display_name?: string | null; preferred_name?: string | null; email?: string | null }): string {
  return (
    [u.first_name, u.last_name].filter(Boolean).join(" ") ||
    u.display_name ||
    u.email ||
    "Staff member"
  );
}

export default async function StaffCvPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // A staff member viewing their own card belongs on /profile, where the
  // edit form lives — redirect rather than duplicate that UI here.
  if (userId === user.id) redirect("/profile");

  if (!(await canViewStaffCard(supabase, user.id, userId))) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: owner }, { data: entries }, isAdmin, isLeadership] = await Promise.all([
    getCardOwner(admin, userId),
    listCvEntries(admin, userId),
    callerIsAdmin(supabase, user.id),
    isLeadershipTeam(supabase, user.id),
  ]);
  if (!owner) notFound();

  return (
    <div className="ffsa-screen">
      <Masthead context="Staff CV" title={nameOf(owner)} />
      <div className="flex items-center gap-3 border-b border-rule px-5 py-4 md:px-8">
        <UserAvatar src={owner.avatar_url} name={nameOf(owner)} size={40} />
        {owner.email && <p className="text-sm text-muted-foreground">{owner.email}</p>}
      </div>
      <div className="px-5 py-6 md:px-8 md:py-7">
        <StaffCvCard
          targetUserId={userId}
          viewer={{ id: user.id, isAdmin, isLeadership }}
          initialEssenceStatement={String(owner.essence_statement ?? "")}
          initialEntries={(entries ?? []) as CvEntry[]}
        />
      </div>
    </div>
  );
}
