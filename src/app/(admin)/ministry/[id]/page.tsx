import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMinistry, getMinistryRoster, listPickableUsers } from "@/services/ministries";
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
  const [{ data: ministry }, { data: roster }, { data: pickable }] = await Promise.all([
    getMinistry(admin, id),
    getMinistryRoster(admin, id),
    listPickableUsers(admin),
  ]);
  if (!ministry) notFound();

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
        pickable={pickable ?? []}
        isAdmin={isAdmin}
      />
    </div>
  );
}
