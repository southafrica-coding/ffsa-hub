import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedbackFormBySlug } from "@/services/event-feedback";
import { parseFeedbackSchema } from "@/lib/feedback/schema";
import { FeedbackRuntime } from "./feedback-runtime";
import { HubFormNotice } from "./hub-shell";

export const dynamic = "force-dynamic";

// Public post-event feedback form. One open link per form — whoever holds
// it can answer, which is the point: volunteers rarely have Hub accounts.
//
// Unlike the ticketing storefront and the CRM capture forms, this page
// wears FFSA Hub branding rather than the event's brand: the audience is
// the team that ran the event, and the form is a Hub tool they are being
// asked to use. The event is named in the context line, not the chrome.
export default async function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // The service-role client, like the ticketing storefront: anon has no
  // read on `events`, so the anon client can't resolve the event title.
  // Publication is enforced in code below — only a form with status
  // 'open' ever renders its questions.
  const supabase = createAdminClient();
  const { data: form } = await getFeedbackFormBySlug(supabase, slug);

  const closedByDate = !!form?.closes_at && new Date(form.closes_at) < new Date();
  const event = (form?.events ?? null) as { title?: string } | null;
  const eventTitle = event?.title ?? "";

  if (!form || form.status !== "open" || closedByDate) {
    const closed = !!form && (form.status === "closed" || closedByDate);
    return (
      <HubFormNotice
        context={eventTitle ? `${eventTitle} · POST-EVENT FEEDBACK` : "POST-EVENT FEEDBACK"}
        title={closed ? "Feedback has closed" : "Form not available"}
        body={
          closed
            ? "Thank you — this feedback form is no longer accepting responses."
            : "This form may not be open yet, or the link is incorrect. Please check with whoever sent it to you."
        }
      />
    );
  }

  return (
    <FeedbackRuntime
      slug={slug}
      schema={parseFeedbackSchema(form.schema)}
      formTitle={form.title}
      intro={form.intro}
      eventTitle={eventTitle}
      isAnonymous={form.is_anonymous}
      thankYouHeading={form.thank_you_heading}
      thankYouMessage={form.thank_you_message}
    />
  );
}
