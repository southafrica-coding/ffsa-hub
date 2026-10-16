// The ticket confirmation email for an event's brand — its subject and its
// design — in one place, so a real send and the Emails-tab preview are the
// same email (src/lib/ticketing/fulfillment.ts, the email-settings route).

import { ticketConfirmationEmailHtml } from "@/lib/email/templates/ticket-confirmation";
import { theSendTicketEmailHtml } from "@/lib/email/templates/the-send-ticket-confirmation";
import { campsTicketEmailHtml } from "@/lib/email/templates/ffsa-camps-ticket-confirmation";
import { preachersTicketEmailHtml } from "@/lib/email/templates/preachers-ticket-confirmation";
import { wildOnesTicketEmailHtml } from "@/lib/email/templates/wild-ones-ticket-confirmation";
import { missioTicketEmailHtml } from "@/lib/email/templates/missio-ticket-confirmation";
import type { EventBrandKey } from "@/lib/email/event-sender";

export type TicketEmailArgs = Parameters<typeof ticketConfirmationEmailHtml>[0];

export function ticketEmailSubject(brand: EventBrandKey, eventTitle: string): string {
  switch (brand) {
    case "the_send":
      return `You're in — ${eventTitle} →`;
    case "ffsa_camps":
      return `you're in 🤞 — ${eventTitle}`;
    case "preachers":
      return `You're in — ${eventTitle} ⚡`;
    case "wild_ones":
      return `You're in — ${eventTitle} 🔥`;
    case "missio":
      return `You're in — ${eventTitle} ✝`;
    default:
      return `Your tickets for ${eventTitle}`;
  }
}

export function ticketEmailHtml(brand: EventBrandKey, args: TicketEmailArgs): string {
  switch (brand) {
    case "the_send":
      return theSendTicketEmailHtml(args);
    case "ffsa_camps":
      return campsTicketEmailHtml(args);
    case "preachers":
      return preachersTicketEmailHtml(args);
    case "wild_ones":
      return wildOnesTicketEmailHtml(args);
    case "missio":
      return missioTicketEmailHtml(args);
    default:
      return ticketConfirmationEmailHtml(args);
  }
}
