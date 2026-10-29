import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { Masthead } from "@/components/ffsa";
import { isHiddenFromNav } from "@/config/modules";

export default async function TeamsPage() {
  // Unbuilt placeholder — out of the menu, so send direct visits home.
  if (isHiddenFromNav("teams")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "teams");

  return (
    <div className="ffsa-screen">
      <Masthead context="Ministry teams" title="Teams" />

      {/* Still unbuilt, said plainly. The panel this replaced used
          dark-theme classes — white text and a translucent white border on
          what is now a white page, so the copy was invisible. */}
      <div className="border-b border-rule px-5 py-12 md:px-8 md:py-16">
        <div className="max-w-xl">
          <div className="mono-label mb-3">Not built yet</div>
          <h2 className="font-display text-[34px] font-black uppercase leading-[0.95] text-ink md:text-[44px]">
            Team rosters
            <br />
            will live here
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            Ministry and outreach team rosters, department structure, and team
            leadership across all FFSA ministries.
          </p>
        </div>
      </div>
    </div>
  );
}
