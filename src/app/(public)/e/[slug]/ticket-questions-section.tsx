"use client";

import {
  CheckoutQuestionFields,
  type CheckoutFieldClasses,
} from "./checkout-questions-fields";
import type { TicketQuestionSlot } from "@/lib/ticketing/ticket-questions";

// Renders the per-ticket question blocks on a storefront: one titled
// block per ticket of a tier that has questions ("Kids Ticket · Ticket 1",
// "…Ticket 2"). Brand-agnostic — reuses each storefront's own
// CheckoutFieldClasses so the inputs match the buyer fields above, exactly
// like the event-level CheckoutQuestionFields. Answer state is namespaced
// per slot key so two kids tickets keep separate answers.

export function TicketQuestionsSection({
  slots,
  valuesBySlot,
  errorsBySlot,
  onChange,
  classes,
  titleClassName,
}: {
  slots: TicketQuestionSlot[];
  valuesBySlot: Record<string, Record<string, unknown>>;
  errorsBySlot: Record<string, Record<string, string>>;
  onChange: (slotKey: string, fieldKey: string, value: unknown) => void;
  classes: CheckoutFieldClasses;
  titleClassName?: string;
}) {
  if (slots.length === 0) return null;
  return (
    <div className="space-y-5">
      {slots.map((slot) => (
        <div key={slot.key} className="space-y-3">
          <p
            className={
              titleClassName ??
              "text-sm font-semibold text-foreground normal-case tracking-normal"
            }
          >
            {slot.ticketTypeName} · Ticket {slot.index + 1}
          </p>
          <CheckoutQuestionFields
            questions={slot.questions}
            values={valuesBySlot[slot.key] ?? {}}
            errors={errorsBySlot[slot.key] ?? {}}
            onChange={(k, v) => onChange(slot.key, k, v)}
            classes={classes}
            idPrefix={`tq-${slot.key}`}
          />
        </div>
      ))}
    </div>
  );
}
