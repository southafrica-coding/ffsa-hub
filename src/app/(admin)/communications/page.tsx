import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { listCampaigns, listSendingIdentities } from "@/services/campaigns";
import { getCachedActiveLabels } from "@/lib/cached-reads";
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-eyebrow">ANNOUNCEMENTS &amp; OUTREACH</p>
          <h1 className="page-title">Communications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send emails to your contact labels.
          </p>
        </div>
        <div className="flex gap-1.5">
          <a
            href="/communications/automations"
            className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
          >
            Automations →
          </a>
          <a
            href="/communications/labels"
            className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
          >
            Labels →
          </a>
          <a
            href="/communications/identities"
            className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
          >
            Identities →
          </a>
          <a
            href="/communications/brand"
            className="text-sm px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
          >
            Brand kits →
          </a>
        </div>
      </div>

      <CampaignsList
        campaigns={campaigns ?? []}
        labels={labels ?? []}
        identities={identities ?? []}
      />
    </div>
  );
}
