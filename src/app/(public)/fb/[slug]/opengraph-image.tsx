import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedbackFormBySlug } from "@/services/event-feedback";
import { hubOgCard, HUB_OG_SIZE, HUB_OG_CONTENT_TYPE } from "@/lib/og/hub-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "FFSA Hub feedback form";
export const size = HUB_OG_SIZE;
export const contentType = HUB_OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: form } = await getFeedbackFormBySlug(supabase, slug);
  const event = (form?.events ?? null) as { title?: string } | null;

  return await hubOgCard({
    eyebrow: "Post-event feedback",
    title: form?.title ?? "Feedback",
    meta: [event?.title, "About 3 minutes"].filter(Boolean).join("  ·  "),
  });
}
