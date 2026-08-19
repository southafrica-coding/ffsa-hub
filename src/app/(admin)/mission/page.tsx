import { Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { Masthead, ComingSoon } from "@/components/ffsa";

export default async function MissionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "mission");
  return (
    <div className="ffsa-screen">
      <Masthead context="Outreach & impact" title="Mission" />
      <div className="px-5 py-6 md:px-8">
        <ComingSoon icon={<Globe className="h-9 w-9" />}>
          The Mission module is under development. It will track outreach trips,
          visiting teams, and ministry impact statistics including salvations,
          healings, gospel seeds, bibles distributed, and hours of prayer across
          all FFSA ministry activities.
        </ComingSoon>
      </div>
    </div>
  );
}
