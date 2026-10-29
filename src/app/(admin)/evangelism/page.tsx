import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { Masthead } from "@/components/ffsa";
import { isHiddenFromNav } from "@/config/modules";

export default async function EvangelismPage() {
  // Unbuilt placeholder — out of the menu, so send direct visits home.
  if (isHiddenFromNav("evangelism")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "evangelism");

  return (
    <div className="ffsa-screen">
      <Masthead context="Sharing the gospel" title="Evangelism" />

      {/* See mission/page.tsx and teams/page.tsx — same not-built-yet panel. */}
      <div className="border-b border-rule px-5 py-12 md:px-8 md:py-16">
        <div className="max-w-xl">
          <div className="mono-label mb-3">Not built yet</div>
          <h2 className="font-display text-[34px] font-black uppercase leading-[0.95] text-ink md:text-[44px]">
            A new module,
            <br />
            still empty
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            This is a placeholder for the Evangelism module. Nothing is built
            here yet, and only admins can see it while it&apos;s in
            progress.
          </p>
        </div>
      </div>
    </div>
  );
}
