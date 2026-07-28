import { createAdminClient } from "@/lib/supabase/admin";
import { getEventBySlug } from "@/services/events";
import { listTicketTypesByEvent } from "@/services/ticketing";
import { FfsaStorefront } from "./ffsa-storefront";
import { TheSendStorefront } from "./the-send-storefront";
import { CampsStorefront } from "./camps-storefront";
import { PreachersStorefront } from "./preachers-storefront";
import { resolveBuyerFields } from "@/lib/ticketing/buyer-fields";
import { PublicFormNotice } from "@/components/public-form-shell";
import type { FormField } from "@/lib/forms/schema";

type EventBrand = "ff" | "the_send" | "ffsa_camps" | "preachers";

// Bespoke landing pages keyed by the event's brand flag (migration 077 +
// the ffsa_camps follow-up). THE SEND, FFSA Camps and PREACHERS each get
// their own bespoke storefront; the FFSA house brand ('ff', also the
// default) renders the FfsaStorefront built against the FFSA Brand Deck.
// All are intentionally event-bespoke and own the full viewport. An
// explicit brand always wins; the legacy slug/title heuristic only runs
// for unmigrated rows (brand null/empty) so they still route correctly
// until every event row has its brand set.
function resolveEventBrand(event: {
  brand?: string | null;
  public_slug?: string | null;
  title?: string | null;
}): EventBrand {
  if (event.brand === "the_send") return "the_send";
  if (event.brand === "ffsa_camps") return "ffsa_camps";
  if (event.brand === "preachers") return "preachers";
  if (event.brand) return "ff";
  const slug = (event.public_slug ?? "").toLowerCase();
  const title = (event.title ?? "").toLowerCase();
  if (slug.includes("the-send") || title.includes("the send")) return "the_send";
  if (slug.includes("ffsa-camps") || slug.includes("camps") || title.includes("camps"))
    return "ffsa_camps";
  if (slug.includes("preachers") || title.includes("preachers")) return "preachers";
  return "ff";
}

export const dynamic = "force-dynamic";

export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createAdminClient();

  const { data: event } = await getEventBySlug(supabase, slug);

  // A cancelled event that ticket holders may be revisiting: show the
  // organiser's cancellation note rather than the generic notice, so
  // people who bought tickets understand what happened.
  if (event?.status === "cancelled") {
    return (
      <PublicFormNotice
        eyebrow="Event cancelled"
        heading={`${event.title} has been cancelled`}
        body={
          event.cancellation_message?.trim() ||
          "This event is no longer going ahead. If you bought a ticket, you'll be refunded to the card or account you paid from."
        }
      />
    );
  }

  if (
    !event ||
    !event.ticketing_enabled ||
    event.status !== "published"
  ) {
    return (
      <PublicFormNotice
        eyebrow="Event"
        heading="Event not available"
        body="This event may have ended, been moved, or the link is incorrect."
      />
    );
  }

  const { data: ticketTypes } = await listTicketTypesByEvent(
    supabase,
    event.id,
    { onlyActive: true }
  );

  const eventProps = {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    start_date: event.start_date,
    end_date: event.end_date,
    start_time: event.start_time,
    end_time: event.end_time,
    logo_url: event.logo_url ?? null,
    // Drives price formatting and which pay buttons render — PayFast
    // is ZAR-only, so a non-ZAR event is Stripe-only.
    currency: event.currency ?? "ZAR",
  };

  const brand = resolveEventBrand(event);
  const checkoutQuestions =
    (event.checkout_questions as FormField[] | null) ?? [];
  // Resolve once here (email forced on+required, hidden fields never
  // required) so every storefront gets a complete, safe config.
  const buyerFields = resolveBuyerFields(event.buyer_fields);

  if (brand === "the_send") {
    return (
      <TheSendStorefront
        event={eventProps}
        ticketTypes={ticketTypes ?? []}
        checkoutQuestions={checkoutQuestions}
        buyerFields={buyerFields}
      />
    );
  }
  if (brand === "ffsa_camps") {
    return (
      <CampsStorefront
        event={eventProps}
        ticketTypes={ticketTypes ?? []}
        checkoutQuestions={checkoutQuestions}
        buyerFields={buyerFields}
      />
    );
  }
  if (brand === "preachers") {
    return (
      <PreachersStorefront
        event={eventProps}
        ticketTypes={ticketTypes ?? []}
        checkoutQuestions={checkoutQuestions}
        buyerFields={buyerFields}
      />
    );
  }

  // brand === "ff" — the FFSA house brand. Bespoke full-viewport
  // storefront built against the FFSA Brand Deck, reading the same brand
  // module as the FFSA emails so the buyer's whole journey is one identity.
  return (
    <FfsaStorefront
      event={eventProps}
      ticketTypes={ticketTypes ?? []}
      checkoutQuestions={checkoutQuestions}
      buyerFields={buyerFields}
    />
  );
}
