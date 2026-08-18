import type { Metadata } from "next";

// The link preview says what this link IS. It deliberately names no
// person: a preview card renders in whatever chat the link was pasted
// into, so pulling the applicant's or recipient's name in here would
// leak them to everyone in the room.
export const metadata: Metadata = {
  title: "Email preferences",
  description: "Choose what Fire & Fragrance South Africa sends you.",
  openGraph: {
    title: "Email preferences",
    description: "Choose what Fire & Fragrance South Africa sends you.",
    type: "website",
  },
  // Personal link — never index it.
  robots: { index: false, follow: false },
};

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrefsToken } from "@/lib/tokens/unsubscribe";
import { PreferencesForm } from "./preferences-form";
import {
  PublicFormNotice,
  PublicFormShell,
  PublicFormInputStyles,
} from "@/components/public-form-shell";

export const dynamic = "force-dynamic";

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const token = t ?? "";
  const v = verifyPrefsToken(token);

  if (!v.valid || !v.contactId) {
    return (
      <PublicFormNotice
        eyebrow="Preferences"
        heading="Link not valid"
        body={`This preferences link is ${v.reason ?? "invalid"}. Please use the link from a recent email.`}
      />
    );
  }

  const admin = createAdminClient();

  // Contact's current labels + (if this came from a campaign email) the
  // labels that campaign targeted, so we can highlight them at the top.
  const [{ data: held }, { data: campaignLabels }] = await Promise.all([
    admin
      .from("contact_labels")
      .select("labels(id, name)")
      .eq("contact_id", v.contactId),
    v.campaignId
      ? admin
          .from("campaign_labels")
          .select("label_id")
          .eq("campaign_id", v.campaignId)
      : Promise.resolve({ data: null }),
  ]);

  const labels = (held ?? [])
    .map((r: { labels: { id: string; name: string } | null }) => r.labels)
    .filter((l): l is { id: string; name: string } => !!l);

  const highlightedLabelIds = new Set(
    ((campaignLabels ?? []) as { label_id: string }[]).map((r) => r.label_id)
  );

  return (
    <div className="ffsa-public">
      <PublicFormInputStyles />
      <PublicFormShell
        eyebrow="Email Preferences"
        heading="Stay or step away"
        subheading="Uncheck anything you want to stop receiving. Changes save when you hit the button at the bottom."
        maxWidth={520}
      >
        <PreferencesForm
          token={token}
          labels={labels.map((l) => ({ id: l.id, name: l.name }))}
          highlightedLabelIds={Array.from(highlightedLabelIds)}
        />
      </PublicFormShell>
    </div>
  );
}
