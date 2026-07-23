import { TicketingSettings } from "./ticketing-settings";
import { TicketTypesManager } from "./ticket-types-manager";
import { PromoCodesManager } from "./promo-codes-manager";
import { CheckoutQuestionsManager } from "./checkout-questions-manager";
import type { FeeProfile } from "@/lib/payments/pricing";
import type { FormField } from "@/lib/forms/schema";

// Composer for the Tickets tab on the event detail page. The
// individual sub-managers handle their own CRUD via API routes;
// data is fetched server-side in page.tsx and passed through.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TicketTypeRow = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromoCodeRow = any;

export function TicketsTab({
  eventId,
  ticketingEnabled,
  publicSlug,
  ticketTypes,
  promoCodes,
  feeProfiles,
  checkoutQuestions,
  currency,
  currencyLocked,
}: {
  eventId: string;
  ticketingEnabled: boolean;
  publicSlug: string | null;
  ticketTypes: TicketTypeRow[];
  promoCodes: PromoCodeRow[];
  feeProfiles: FeeProfile[];
  checkoutQuestions: FormField[];
  currency: string;
  currencyLocked: boolean;
}) {
  return (
    <div className="space-y-6">
      <TicketingSettings
        eventId={eventId}
        ticketingEnabled={ticketingEnabled}
        publicSlug={publicSlug}
        currency={currency}
        currencyLocked={currencyLocked}
      />
      <TicketTypesManager
        eventId={eventId}
        ticketTypes={ticketTypes}
        feeProfiles={feeProfiles}
        currency={currency}
      />
      <PromoCodesManager
        eventId={eventId}
        promoCodes={promoCodes}
        ticketTypes={ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
        currency={currency}
      />
      <CheckoutQuestionsManager
        eventId={eventId}
        initialQuestions={checkoutQuestions}
      />
    </div>
  );
}
