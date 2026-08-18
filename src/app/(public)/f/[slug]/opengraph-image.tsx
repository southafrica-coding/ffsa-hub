import { createAdminClient } from "@/lib/supabase/admin";
import { getFormBySlug } from "@/services/forms";
import { hubOgCard, HUB_OG_SIZE, HUB_OG_CONTENT_TYPE } from "@/lib/og/hub-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "FFSA Hub form";
export const size = HUB_OG_SIZE;
export const contentType = HUB_OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: form } = await getFormBySlug(supabase, slug);
  const event = (form?.events ?? null) as { title?: string } | null;

  return await hubOgCard({
    eyebrow: "Form",
    title: form?.name ?? "FFSA Hub form",
    meta: event?.title ?? null,
  });
}
