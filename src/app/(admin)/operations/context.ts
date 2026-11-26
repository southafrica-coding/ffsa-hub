import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOpsTeam } from "@/lib/operations/access";
import { listOpsTeam } from "@/services/operations";

/** Signed-in user, whether they're on the operations team / an admin, and who tasks can go to. */
export async function opsContext(options: { teamOnly: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const isTeam = await isOpsTeam(supabase, user.id);
  if (options.teamOnly && !isTeam) redirect("/dashboard");

  const { data: roles } = await supabase.from("user_roles").select("roles(name)").eq("user_id", user.id);
  const isAdmin = ((roles ?? []) as { roles: { name: string } | { name: string }[] | null }[]).some((r) =>
    (Array.isArray(r.roles) ? r.roles : [r.roles]).some((x) => x?.name === "admin" || x?.name === "super_admin")
  );

  // Names and ids only leave the server — never the admin rows themselves.
  const people = isTeam ? (await listOpsTeam(createAdminClient())).map(({ id, name }) => ({ id, name })) : [];
  return { supabase, user, isTeam, isAdmin, people };
}
