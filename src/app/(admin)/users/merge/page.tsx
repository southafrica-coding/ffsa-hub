import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Masthead, SectionBar } from "@/components/ffsa";
import { MergeUsersClient } from "./merge-users-client";

export const dynamic = "force-dynamic";

export default async function MergeUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ loser?: string }>;
}) {
  const { loser } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // super_admin and admin, matching the API. Checked here as well so the screen
  // is not merely a dead end for someone who can reach /users.
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", user.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) redirect("/users");

  return (
    <div className="ffsa-screen">
      <Masthead context="System access · Merge duplicate people" title="Merge accounts" />

      <SectionBar title="Merge two accounts into one" />
      <p className="max-w-3xl border-b border-rule px-5 py-4 text-[14px] leading-relaxed text-[color:var(--text-secondary)] md:px-8">
        Use this when the same person has two Hub accounts — usually because
        they applied with one email while a profile already existed under
        another. Their application, enrolment, billing plan, consent records,
        household and insurance all move onto the account you keep. The other
        account is deactivated and locked, never deleted, so nothing is lost
        and the pair stays traceable.
      </p>

      <div className="px-5 py-6 md:px-8 md:py-7">
        <MergeUsersClient initialLoserId={loser ?? null} viewerId={user.id} />
      </div>
    </div>
  );
}
