import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listCampaigns, listSendingIdentities } from "@/services/campaigns";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { Masthead, NeedsYou } from "@/components/ffsa";
import { CampaignsList } from "./campaigns-list";

export default async function CommunicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  const [{ data: campaigns }, { data: labels }, { data: identities }] =
    await Promise.all([
      listCampaigns(supabase, { limit: 100 }),
      getCachedActiveLabels(),
      listSendingIdentities(supabase),
    ]);

  const rows = campaigns ?? [];
  // Drives the page's one yellow band — read off the campaigns already
  // fetched above, no extra query.
  const failed = rows.filter(
    (c: { status: string }) => c.status === "failed"
  ).length;

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Announcements & Outreach"
        title="Communications"
        actions={
          <>
            <SubNav href="/communications/automations">Automations</SubNav>
            <SubNav href="/communications/labels">Labels</SubNav>
            <SubNav href="/communications/identities">Identities</SubNav>
            <SubNav href="/communications/brand">Brand kits</SubNav>
          </>
        }
      />

      {/* The page's ONE yellow band. Never add a second. */}
      {failed > 0 && (
        <NeedsYou>
          {failed === 1
            ? "1 email failed to send"
            : `${failed} emails failed to send`}
        </NeedsYou>
      )}

      <div className="px-5 py-6 md:px-8 md:py-7">
        <CampaignsList
          campaigns={rows}
          labels={labels ?? []}
          identities={identities ?? []}
        />
      </div>
    </div>
  );
}

// Masthead actions double as this module's sub-nav; chips, not buttons, so
// they never compete with the black primary action in the list below.
function SubNav({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="chip hover:border-ink hover:text-ink">
      {children}
    </Link>
  );
}
