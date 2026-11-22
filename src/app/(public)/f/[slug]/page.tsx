import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { accessModeOf, formAccessDecision } from "@/lib/forms/access";
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
  if (raw === "wild_ones") return "wild_ones";
  if (raw === "missio") return "missio";
  return "ff";
}

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // The service-role client, like the ticketing storefront and the
  // feedback form: anon has NO read on `events` (migration 002/086 give
  // every SELECT branch an auth.uid() or role test), so the anon client
  // resolved `form.events` to null and every branded event's form fell
  // back to the default F&F chrome with no event logo. Publication is
  // enforced in code immediately below — an inactive form still shows the
  // notice, exactly as before.
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

  // Who may fill it (migration 390). Public forms never touch the session.
  const accessMode = accessModeOf((form as { access_mode?: unknown }).access_mode);
  if (accessMode !== "public") {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    const decision = formAccessDecision(accessMode, Boolean(user));
    if (decision === "sign_in") {
      return (
        <PublicFormNotice
          heading="Sign in to fill this in"
          body="This form is for people with an FFSA Hub login. Sign in to the Hub, then open this link again."
        />
      );
    }
    if (decision === "closed") {
      return (
        <PublicFormNotice
          heading="Form not available"
          body="This form opens from a personal link. Please use the link you were sent."
        />
      );
    }
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
