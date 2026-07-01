import { createClient } from "@/lib/supabase/server";
import { getFormBySlug } from "@/services/forms";
import { emptyFormSchema, type FormSchema } from "@/lib/forms/schema";
import { FormRuntime } from "./form-runtime";
import {
  PublicFormNotice,
  type PublicShellBrand,
} from "@/components/public-form-shell";

export const dynamic = "force-dynamic";

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
  const supabase = await createClient();
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
