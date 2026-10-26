import { TicketingSettings } from "./ticketing-settings";
import { PayLaterSettings } from "./pay-later-settings";
import { TicketTypesManager } from "./ticket-types-manager";
import { PromoCodesManager } from "./promo-codes-manager";
import { CheckoutQuestionsManager } from "./checkout-questions-manager";
import { BuyerFieldsManager } from "./buyer-fields-manager";
import type { FeeProfile } from "@/lib/payments/pricing";
import type { FormField } from "@/lib/forms/schema";
import { isWaiverActive } from "@/lib/ticketing/waivers";
import type { TierCount } from "@/lib/ticketing/tier-inventory";

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
  tierCounts,
  promoCodes,
  feeProfiles,
  checkoutQuestions,
  buyerFields,
  currency,
  currencyLocked,
  startDate,
}: {
  eventId: string;
  ticketingEnabled: boolean;
  publicSlug: string | null;
  ticketTypes: TicketTypeRow[];
  tierCounts: Record<string, TierCount>;
  promoCodes: PromoCodeRow[];
  feeProfiles: FeeProfile[];
  checkoutQuestions: FormField[];
  buyerFields: unknown;
  currency: string;
  currencyLocked: boolean;
  startDate?: string | null;
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
      {/* Keyed on currency: the Xero org (and so the item) follows it. */}
      <PayLaterSettings key={currency} eventId={eventId} startDate={startDate ?? null} />
      <TicketTypesManager
        eventId={eventId}
        ticketTypes={ticketTypes}
        tierCounts={tierCounts}
        feeProfiles={feeProfiles}
        currency={currency}
      />
      <PromoCodesManager
        eventId={eventId}
        promoCodes={promoCodes}
        ticketTypes={ticketTypes.map((t) => ({
          id: t.id,
          name: t.name,
          // What a code can waive on this tier (migration 269).
          questions: Array.isArray(t.questions) ? t.questions : [],
          hasWaiver: isWaiverActive(t.waiver),
        }))}
        currency={currency}
      />
      <BuyerFieldsManager eventId={eventId} initialFields={buyerFields} />
      <CheckoutQuestionsManager
        eventId={eventId}
        initialQuestions={checkoutQuestions}
      />
    </div>
  );
}
