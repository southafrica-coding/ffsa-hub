import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  listCampaigns,
  listSendingIdentities,
  getCampaignStatsBulk,
} from "@/services/campaigns";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { countNewInbound } from "@/services/inbound-emails";
import { Masthead, NeedsYou } from "@/components/ffsa";
import { CampaignsList } from "./campaigns-list";

export default async function CommunicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "communications");

  // The stats read has to know which campaigns it is counting, so it is
  // chained onto the list fetch INSIDE the Promise.all — it overlaps with
  // the labels and identities reads instead of waiting for the whole batch.
  const [{ rows, stats }, { data: labels }, { data: identities }, newReplies] =
    await Promise.all([
      (async () => {
        const { data } = await listCampaigns(supabase, { limit: 100 });
        const rows = data ?? [];
        // One query for every row's open/click rate. Returns an empty map
        // (rates render as "—") until migration 164 creates the view.
        const stats = await getCampaignStatsBulk(
          supabase,
          rows.map((c: { id: string }) => c.id)
        );
        return { rows, stats };
      })(),
      getCachedActiveLabels(),
      listSendingIdentities(supabase),
      countNewInbound(supabase),
    ]);

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
            <SubNav href="/communications/inbox">
              Inbox{newReplies > 0 ? ` · ${newReplies}` : ""}
            </SubNav>
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
          // Plain object, not a Map, so it crosses the server → client
          // boundary as ordinary JSON. Empty before migration 164.
          stats={Object.fromEntries(stats)}
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
