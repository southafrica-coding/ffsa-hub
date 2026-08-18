import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedbackFormBySlug } from "@/services/event-feedback";
import { parseFeedbackSchema } from "@/lib/feedback/schema";
import { FeedbackRuntime } from "./feedback-runtime";
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

// Public post-event feedback form. One open link per form — whoever holds
// it can answer, which is the point: volunteers rarely have Hub accounts.
export default async function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // The service-role client, like the ticketing storefront: anon has no
  // read on `events`, so the anon client would render every form in the
  // default brand with no event logo. Publication is enforced in code
  // below — only a form with status 'open' ever renders its questions.
  const supabase = createAdminClient();
  const { data: form } = await getFeedbackFormBySlug(supabase, slug);

  const closedByDate = !!form?.closes_at && new Date(form.closes_at) < new Date();

  if (!form || form.status !== "open" || closedByDate) {
    return (
      <PublicFormNotice
        heading={form && (form.status === "closed" || closedByDate)
          ? "Feedback has closed"
          : "Form not available"}
        body={
          form && (form.status === "closed" || closedByDate)
            ? "Thank you — this feedback form is no longer accepting responses."
            : "This form may not be open yet, or the link is incorrect. Please check with whoever sent it to you."
        }
      />
    );
  }

  const event = (form.events ?? null) as {
    title?: string;
    brand?: string | null;
    logo_url?: string | null;
  } | null;

  return (
    <FeedbackRuntime
      slug={slug}
      schema={parseFeedbackSchema(form.schema)}
      formTitle={form.title}
      intro={form.intro}
      eventTitle={event?.title ?? ""}
      eventLogoUrl={event?.logo_url ?? null}
      brand={normalizeBrand(event?.brand)}
      isAnonymous={form.is_anonymous}
      thankYouHeading={form.thank_you_heading}
      thankYouMessage={form.thank_you_message}
    />
  );
}
