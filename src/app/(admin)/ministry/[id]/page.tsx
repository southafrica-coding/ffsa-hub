import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getMinistry,
  getMinistryRoster,
  listPickableUsers,
  listSubcategories,
} from "@/services/ministries";
import { deriveUserLifecycle } from "@/lib/users/lifecycle";
import { callerIsAdmin, callerLeadsMinistry } from "@/lib/auth/check-ministry-access";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { MinistryDetail } from "./ministry-detail";

export default async function MinistryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isAdmin = await callerIsAdmin(supabase, user.id);
  const leadsThisMinistry = await callerLeadsMinistry(supabase, user.id, id);
  // Leadership Team can VIEW any ministry's roster — same blanket visibility
  // they get elsewhere (OKRs, the Ministry list page) — but management stays
  // limited to admins and that specific ministry's own leaders.
  const canView = isAdmin || leadsThisMinistry || (await isLeadershipTeam(supabase, user.id));
  if (!canView) redirect("/dashboard");
  const canManage = isAdmin || leadsThisMinistry;

  const admin = createAdminClient();
  const [
    { data: ministry },
    { data: roster },
    { data: pickable },
    { data: subcategories },
  ] = await Promise.all([
    getMinistry(admin, id),
    getMinistryRoster(admin, id),
    listPickableUsers(admin),
    listSubcategories(admin, id),
  ]);
  if (!ministry) notFound();

  // Only people whose profile is FULLY SET UP (the profile-completion gate
  // would pass — no missing required fields) may be added to a ministry or
  // made a leader. Project to the minimal fields the picker needs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eligiblePickable = ((pickable ?? []) as any[])
    .filter((u) => deriveUserLifecycle(u).missingFields.length === 0)
    .map((u) => ({
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      display_name: u.display_name,
      preferred_name: u.preferred_name,
      email: u.email,
    }));

  return (
    <div className="ffsa-screen">
      <MinistryDetail
        ministry={ministry}
        roster={roster ?? []}
        pickable={eligiblePickable}
        subcategories={subcategories ?? []}
        isAdmin={isAdmin}
        canManage={canManage}
      />
    </div>
  );
}
