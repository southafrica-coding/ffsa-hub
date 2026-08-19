import { UsersRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { Masthead, ComingSoon } from "@/components/ffsa";

export default async function TeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "teams");
  return (
    <div className="ffsa-screen">
      <Masthead context="Ministry teams" title="Teams" />
      <div className="px-5 py-6 md:px-8">
        <ComingSoon icon={<UsersRound className="h-9 w-9" />}>
          The Teams module is under development. It will manage ministry and
          outreach team rosters, department structure, and team leadership for
          all FFSA ministries.
        </ComingSoon>
      </div>
    </div>
  );
}
