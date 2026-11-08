// Wild Ones pay attempt: list every missing requirement in plain language,
// and refuse the checkout request until all of them pass. Messages name
// the field only — never the value the buyer typed.

import type { FormField } from "@/lib/forms/schema";
import { fieldKey } from "@/lib/forms/schema";
import {
  buyerFieldMap,
  type BuyerFieldConfig,
} from "@/lib/ticketing/buyer-fields";
import { validateCheckoutAnswers } from "@/lib/ticketing/checkout-questions";
import type { TicketQuestionSlot } from "@/lib/ticketing/ticket-questions";
import {
  validateWaiverValues,
  type WaiverSlot,
  type WaiverSlotValues,
} from "@/lib/ticketing/waivers";

export type WildOnesCheckoutFailure =
  | "buyer"
  | "checkout"
  | "tickets"
  | "waiver"
  | "consent";

export function revealTargetId(failure: WildOnesCheckoutFailure): string {
  if (failure === "tickets") return "wo-ticket-questions";
  if (failure === "waiver") return "wo-waiver";
  if (failure === "consent") return "wo-consent";
  return "wo-buyer";
}

export const WAIVER_BLOCK_MESSAGE =
  "Please read and sign the required form for each ticket.";

export const PAY_SUMMARY_TITLE = "Still needed before you can pay";

export type MissingPayItem = {
  /** DOM id of the control to scroll to, focus, and highlight. */
  fieldId: string;
  /** Plain sentence. Must not contain anything the buyer typed. */
  text: string;
};

export type WildOnesPayInput = {
  lineCount: number;
  buyerFields: BuyerFieldConfig[];
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  checkoutQuestions: FormField[];
  customAnswers: Record<string, unknown>;
  ticketSlots: TicketQuestionSlot[];
  ticketAnswers: Record<string, Record<string, unknown>>;
  waiverSlots: WaiverSlot[];
  waiverValues: Record<string, WaiverSlotValues>;
  /** Ticket Purchase Terms checkbox. Separate from waiver consent. */
  termsAccepted: boolean;
  /** Set only for the invoice / pay-later button. */
  invoiceCountry?: string | null;
};

export type WildOnesPayPlan = {
  action: "block" | "post";
  items: MissingPayItem[];
  checkoutErrors: Record<string, string>;
  ticketErrors: Record<string, Record<string, string>>;
  waiverErrors: Record<string, Record<string, string>>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkoutControlId(fieldId: string): string {
  return `cq-${fieldId}`;
}

export function ticketControlId(slotKey: string, fieldId: string): string {
  return `tq-${slotKey}-${fieldId}`;
}

export function waiverControlId(
  slotKey: string,
  part: "guardian" | "relationship" | "minor" | "signature" | "agreed"
): string {
  return `wo-w-${slotKey}-${part}`;
}

export const TERMS_CONTROL_ID = "wo-terms";
export const INVOICE_COUNTRY_ID = "wo-invoice-country";
export const TICKETS_CONTROL_ID = "wo-tickets";

function place(name: string, index: number): string {
  return `${name}, ticket ${index + 1}`;
}

function questionText(label: string, message: string, where?: string): string {
  const tail = where ? ` for ${where}` : "";
  if (message === "Enter a number") return `${label} needs to be a number${tail}`;
  if (message === "Enter a valid email address") {
    return `${label} needs a valid email address${tail}`;
  }
  return `Fill in ${label}${tail}`;
}

/**
 * Every gate, in page order. `action: "post"` only when nothing is missing.
 * Callers must not start checkout unless action is "post".
 */
export function planWildOnesCheckout(input: WildOnesPayInput): WildOnesPayPlan {
  const items: MissingPayItem[] = [];
  const checkoutErrors: Record<string, string> = {};
  const ticketErrors: Record<string, Record<string, string>> = {};
  const waiverErrors: Record<string, Record<string, string>> = {};

  if (input.lineCount <= 0) {
    items.push({ fieldId: TICKETS_CONTROL_ID, text: "Add at least one pass" });
  }

  const bf = buyerFieldMap(input.buyerFields);
  if (bf.first_name.enabled && bf.first_name.required && !input.firstName.trim()) {
    items.push({ fieldId: "wo-fn", text: "Add a first name" });
  }
  if (bf.last_name.enabled && bf.last_name.required && !input.lastName.trim()) {
    items.push({ fieldId: "wo-ln", text: "Add a last name" });
  }
  const email = input.email.trim();
  if (!email) {
    items.push({ fieldId: "wo-em", text: "Add an email address" });
  } else if (!EMAIL_RE.test(email)) {
    items.push({ fieldId: "wo-em", text: "Enter a valid email address" });
  }
  if (bf.phone.enabled && bf.phone.required && !input.phone.trim()) {
    items.push({ fieldId: "wo-ph", text: "Add a phone number" });
  }

  if (input.checkoutQuestions.length > 0) {
    const v = validateCheckoutAnswers(input.checkoutQuestions, input.customAnswers);
    Object.assign(checkoutErrors, v.errors);
    for (const field of input.checkoutQuestions) {
      const message = v.errors[fieldKey(field)];
      if (!message) continue;
      items.push({
        fieldId: checkoutControlId(field.id),
        text: questionText(field.label, message),
      });
    }
  }

  for (const slot of input.waiverSlots) {
    const values = input.waiverValues[slot.key] ?? {};
    const v = validateWaiverValues(slot.waiver, values);
    if (!v.valid) waiverErrors[slot.key] = v.errors;
    const where = place(slot.ticketTypeName, slot.index);
    if (v.errors.guardian_name) {
      items.push({
        fieldId: waiverControlId(slot.key, "guardian"),
        text: `Add the parent or guardian's full name for ${where}`,
      });
    }
    if (v.errors.relationship) {
      items.push({
        fieldId: waiverControlId(slot.key, "relationship"),
        text: `Add the relationship to the attendee for ${where}`,
      });
    }
    if (v.errors.minor_name) {
      items.push({
        fieldId: waiverControlId(slot.key, "minor"),
        text: `Add the attendee's full name for ${where}`,
      });
    }
    if (v.errors.typed_signature) {
      const guardian = (values.guardian_name ?? "").trim();
      const signature = (values.typed_signature ?? "").trim();
      const mismatch =
        guardian.length > 0 &&
        signature.length > 0 &&
        signature.toLowerCase() !== guardian.toLowerCase();
      items.push({
        fieldId: waiverControlId(slot.key, "signature"),
        text: mismatch
          ? `Type a signature that matches the parent or guardian name for ${where}`
          : `Type the parent or guardian name to sign for ${where}`,
      });
    }
    if (v.errors.agreed) {
      items.push({
        fieldId: waiverControlId(slot.key, "agreed"),
        text: `Tick the parent or guardian consent for ${where}`,
      });
    }
  }

  for (const slot of input.ticketSlots) {
    const values = input.ticketAnswers[slot.key] ?? {};
    const v = validateCheckoutAnswers(slot.questions, values);
    if (!v.valid) ticketErrors[slot.key] = v.errors;
    const where = place(slot.ticketTypeName, slot.index);
    for (const field of slot.questions) {
      const message = v.errors[fieldKey(field)];
      if (!message) continue;
      items.push({
        fieldId: ticketControlId(slot.key, field.id),
        text: questionText(field.label, message, where),
      });
    }
  }

  if (!input.termsAccepted) {
    items.push({
      fieldId: TERMS_CONTROL_ID,
      text: "Tick the Ticket Purchase Terms & Consent Agreement",
    });
  }

  if (input.invoiceCountry !== undefined && !input.invoiceCountry?.trim()) {
    items.push({
      fieldId: INVOICE_COUNTRY_ID,
      text: "Choose a country for the invoice",
    });
  }

  return {
    action: items.length === 0 ? "post" : "block",
    items,
    checkoutErrors,
    ticketErrors,
    waiverErrors,
  };
}

/** How many checkout requests an attempt may make. Invalid plans make none. */
export function checkoutPostsFor(plan: WildOnesPayPlan): 0 | 1 {
  return plan.action === "post" ? 1 : 0;
}
