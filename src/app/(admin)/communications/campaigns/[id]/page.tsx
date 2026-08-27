import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import {
  getCampaignById,
  getCampaignAudienceCount,
  getCampaignStats,
  getCampaignLabelIds,
  getCampaignRecipients,
  listSendingIdentities,
} from "@/services/campaigns";
import { getCachedActiveLabels } from "@/lib/cached-reads";
import { emptyCampaignBody, type CampaignBody } from "@/lib/campaigns/blocks";
import { getEffectiveBrand } from "@/services/brand";
import { Masthead } from "@/components/ffsa";
import { CampaignComposer } from "./campaign-composer";
import { CampaignAnalytics } from "./campaign-analytics";
import {
  CampaignRecipientsTable,
  type RecipientRow,
} from "./recipients-table";

export default async function CampaignComposerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: campaign, error } = await getCampaignById(supabase, id);
  if (error || !campaign) notFound();

  const [{ data: labels }, { data: identities }, audienceCount, labelIds, brand] =
    await Promise.all([
      getCachedActiveLabels(),
      listSendingIdentities(supabase),
      getCampaignAudienceCount(supabase, id),
      getCampaignLabelIds(supabase, id),
      getEffectiveBrand(supabase, campaign.sending_identity_id),
    ]);

  const body: CampaignBody =
    campaign.body_source &&
    typeof campaign.body_source === "object" &&
    "blocks" in campaign.body_source
      ? (campaign.body_source as unknown as CampaignBody)
      : emptyCampaignBody();

  // The public sign-up list the Subscribe module points at (migration 196).
  // If no label is opened up, the palette simply doesn't offer the module.
  const { data: subscribeLabel } = await supabase
    .from("labels")
    .select("name, slug")
    .eq("public_subscribe", true)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://ffsahub.com"
  ).replace(/\/$/, "");
  const subscribeLink = subscribeLabel
    ? {
        name: subscribeLabel.name as string,
        url: `${siteUrl}/subscribe/${subscribeLabel.slug}`,
      }
    : null;

  const showStats =
    campaign.status === "sent" || campaign.status === "sending";
  const [stats, recipientsRes] = showStats
    ? await Promise.all([
        getCampaignStats(supabase, id),
        getCampaignRecipients(supabase, id),
      ])
    : [null, null];
  const recipients = (recipientsRes?.data ?? []) as RecipientRow[];

  return (
    <div className="ffsa-screen">
      <Masthead context="Communications · Email" title={campaign.name} />

      <div className="space-y-4 px-8 py-7">
        {stats && <CampaignAnalytics stats={stats} />}
        {showStats && <CampaignRecipientsTable recipients={recipients} />}
        <CampaignComposer
          campaign={{
            id: campaign.id,
            name: campaign.name,
            subject: campaign.subject ?? "",
            preview_text: campaign.preview_text ?? "",
            label_ids: labelIds,
            sending_identity_id: campaign.sending_identity_id,
            status: campaign.status,
            scheduled_at: campaign.scheduled_at,
          }}
          initialBody={body}
          labels={labels ?? []}
          identities={identities ?? []}
          audienceCount={audienceCount}
          brand={brand}
          currentUserEmail={user.email ?? null}
          subscribeLink={subscribeLink}
        />
      </div>
    </div>
  );
}
