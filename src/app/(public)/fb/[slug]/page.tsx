import { createAdminClient } from "@/lib/supabase/admin";
import { getFeedbackFormBySlug } from "@/services/event-feedback";
import { parseFeedbackSchema } from "@/lib/feedback/schema";
import { FeedbackRuntime } from "./feedback-runtime";
import { HubFormNotice } from "./hub-shell";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * What a messaging app shows when this link is pasted.
 *
 * Without this the link previewed as the generic "FFSA Hub — Internal
 * Operations Platform", so someone receiving it in WhatsApp could not
 * tell it was a feedback form, let alone which event's. Now the title is
 * the form's own name and the description says what it is and roughly
 * what it costs them.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createAdminClient();
  const { data: form } = await getFeedbackFormBySlug(supabase, slug);

  if (!form) return { title: "Feedback form not found" };

  const event = (form.events ?? null) as { title?: string } | null;
  const closed =
    form.status !== "open" ||
    (!!form.closes_at && new Date(form.closes_at) < new Date());

  const where = event?.title ? ` for ${event.title}` : "";
  const description = closed
    ? `This feedback form${where} is closed.`
    : `Share your honest feedback${where}. Takes about three minutes.`;

  return {
    title: form.title,
    description,
    openGraph: {
      title: form.title,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: form.title,
      description,
    },
    // A feedback link is shared with a team, not published.
    robots: { index: false, follow: false },
  };
}

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
