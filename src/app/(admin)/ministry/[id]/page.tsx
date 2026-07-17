import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMinistry, getMinistryRoster, listPickableUsers } from "@/services/ministries";
import { deriveUserLifecycle } from "@/lib/users/lifecycle";
import { callerIsAdmin, callerLeadsMinistry } from "@/lib/auth/check-ministry-access";
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
  if (!isAdmin && !(await callerLeadsMinistry(supabase, user.id, id))) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: ministry }, { data: roster }, { data: pickable }] =
    await Promise.all([
      getMinistry(admin, id),
      getMinistryRoster(admin, id),
      listPickableUsers(admin),
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
    <div className="space-y-6">
      <Link
        href="/ministry"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All ministries
      </Link>
      <MinistryDetail
        ministry={ministry}
        roster={roster ?? []}
        pickable={eligiblePickable}
        isAdmin={isAdmin}
      />
    </div>
  );
}
