import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PublicFormNotice,
  PublicFormShell,
  PublicFormInputStyles,
} from "@/components/public-form-shell";
import { SubscribeForm } from "./subscribe-form";

// Public sign-up page for one label. Unlike /preferences this link carries no
// token and names nobody — it's meant to be shared, forwarded, and pasted, so
// it is safe to index and safe to hand around.
export const metadata: Metadata = {
  title: "Get our updates",
  description: "Sign up for news from Fire & Fragrance South Africa.",
  openGraph: {
    title: "Get our updates",
    description: "Sign up for news from Fire & Fragrance South Africa.",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

export default async function SubscribePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = createAdminClient();

  // Only labels deliberately opened up (migration 196) are joinable; every
  // other label is an internal segment.
  const { data: label } = await admin
    .from("labels")
    .select("id, name, slug, description, public_subscribe, is_active")
    .eq("slug", slug)
    .eq("public_subscribe", true)
    .eq("is_active", true)
    .maybeSingle();

  if (!label) {
    return (
      <PublicFormNotice
        eyebrow="Subscribe"
        heading="This sign-up link isn’t available"
        body="The list you're trying to join is closed or the link is wrong. Please use the link from a recent email."
      />
    );
  }

  return (
    <PublicFormShell
      eyebrow="Stay in the loop"
      heading="Get our updates"
      subheading={
        label.description ??
        "News, stories and what's coming up from Fire & Fragrance South Africa. Unsubscribe any time."
      }
      maxWidth={480}
    >
      <PublicFormInputStyles />
      <SubscribeForm slug={label.slug} labelName={label.name} />
    </PublicFormShell>
  );
}
