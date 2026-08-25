import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { Masthead } from "@/components/ffsa";

export default async function MissionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "mission");

  return (
    <div className="ffsa-screen">
      <Masthead context="Outreach &amp; impact" title="Mission" />

      {/* See teams/page.tsx — same dark-theme panel, same fix. */}
      <div className="border-b border-rule px-5 py-12 md:px-8 md:py-16">
        <div className="max-w-xl">
          <div className="mono-label mb-3">Not built yet</div>
          <h2 className="font-display text-[34px] font-black uppercase leading-[0.95] text-ink md:text-[44px]">
            Outreach trips
            <br />
            and what came of them
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            Trips, visiting teams, and ministry impact — salvations, healings,
            gospel seeds, bibles distributed, and hours of prayer across every
            FFSA activity. Nothing is being counted yet.
          </p>
        </div>
      </div>
    </div>
  );
}
