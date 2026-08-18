import { createAdminClient } from "@/lib/supabase/admin";
import { getFormBySlug } from "@/services/forms";
import { emptyFormSchema, type FormSchema } from "@/lib/forms/schema";
import { FormRuntime } from "./form-runtime";
import {
  PublicFormNotice,
  type PublicShellBrand,
} from "@/components/public-form-shell";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/** What a messaging app shows when this form link is pasted. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // The service-role client purely to resolve the event name: anon has no
  // read on `events`, so the anon client would describe the form with no
  // idea which event it belongs to — which is the whole point of the
  // preview. Nothing beyond name/title is exposed, and a form that isn't
  // live still says so.
  const supabase = createAdminClient();
  const { data: form } = await getFormBySlug(supabase, slug);

  if (!form) return { title: "Form not found" };

  const event = (form.events ?? null) as { title?: string } | null;
  const where = event?.title ? ` · ${event.title}` : "";
  const description = form.is_active
    ? `Fill in ${form.name}${where}.`
    : "This form is not currently open.";

  return {
    title: form.name,
    description,
    openGraph: { title: form.name, description, type: "website" },
    twitter: { card: "summary_large_image", title: form.name, description },
  };
}

function normalizeBrand(raw: unknown): PublicShellBrand {
  if (raw === "the_send") return "the_send";
  if (raw === "ffsa_camps") return "ffsa_camps";
  if (raw === "preachers") return "preachers";
  return "ff";
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Service-role, like every other public page: forms are anon-readable
  // while active, but the embedded events(...) row is staff-only under
  // RLS — through the anon client the join came back null and every
  // logged-out visitor got an unbranded, logo-less form while staff
  // previewing it signed in saw the real thing. The is_active gate the
  // RLS policy used to apply is enforced explicitly just below.
  const supabase = createAdminClient();
  const { data: form } = await getFormBySlug(supabase, slug);

  // For the unavailable-form notice we don't have the event yet, so the
  // notice falls back to the F&F brand. Once the form is loaded we
  // forward the event's brand to the runtime.
  if (!form || !form.is_active) {
    return (
      <PublicFormNotice
        heading="Form not available"
        body="This form may have closed or the link is incorrect. Please check with the sender for an updated link."
      />
    );
  }

  const schema: FormSchema =
    form.schema && typeof form.schema === "object" && "steps" in form.schema
      ? (form.schema as unknown as FormSchema)
      : emptyFormSchema();

  const events =
    form.events && typeof form.events === "object" ? form.events : null;
  const eventLogoUrl =
    events && "logo_url" in events
      ? ((events as { logo_url: string | null }).logo_url ?? null)
      : null;
  const brand: PublicShellBrand = normalizeBrand(
    events && "brand" in events
      ? (events as { brand: string | null }).brand
      : null
  );

  return (
    <FormRuntime
      slug={slug}
      schema={schema}
      formName={form.name}
      eventLogoUrl={eventLogoUrl}
      brand={brand}
    />
  );
}
