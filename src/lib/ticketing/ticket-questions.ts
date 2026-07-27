// ============================================================
// Per-tier ticket questions — shared model + logic (migration 137)
// ============================================================
// Extends the event-level checkout questions (checkout-questions.ts)
// down to the ticket TIER, asked once per TICKET. A tier's questions
// reuse the exact same FormField shape, so the admin builder, the
// storefront field renderer, conditional visibility, per-question
// `required`, and the validator/snapshot are all reused unchanged.
//
// This module adds only the per-ticket plumbing on top of that shared
// model:
//   - the cart → per-ticket "slots" expansion used by the storefront,
//   - the client-side collect+validate that builds the checkout body,
//   - the server-side validate that turns the request into the
//     order.ticket_answers snapshot fulfilment drains onto each ticket.
// All of it is pure (no React) so server and client share one source
// of truth for how answers line up with tickets.
// ============================================================

import type { FormField } from "@/lib/forms/schema";
import {
  type CheckoutAnswerSnapshot,
  validateCheckoutAnswers,
  snapshotAnswers,
} from "@/lib/ticketing/checkout-questions";

// A tier's questions are just checkout questions scoped to the tier.
export type TicketQuestion = FormField;

// Stored on orders.ticket_answers — one entry per ticket whose tier has
// questions. Fulfilment groups these by ticket_type_id and drains one
// onto each issued ticket's custom_answers.
export type TicketAnswerGroup = {
  ticket_type_id: string;
  answers: CheckoutAnswerSnapshot[];
};

// One question-collecting block on the storefront: the i-th ticket of a
// tier that has questions. `key` is stable for React + answer-state maps.
export type TicketQuestionSlot = {
  key: string;
  ticketTypeId: string;
  ticketTypeName: string;
  index: number; // 0-based position within this tier
  questions: FormField[];
};

export function ticketSlotKey(ticketTypeId: string, index: number): string {
  return `${ticketTypeId}:${index}`;
}

// Expand the current cart into per-ticket question blocks. Only tiers
// that actually have questions produce slots; a plain General tier with
// no questions contributes nothing. Cart order is preserved so the
// blocks read top-to-bottom in the same order as the ticket list.
export function computeTicketSlots(
  cart: Array<{ ticketTypeId: string; ticketTypeName: string; qty: number }>,
  questionsByTier: Record<string, FormField[]>
): TicketQuestionSlot[] {
  const slots: TicketQuestionSlot[] = [];
  for (const line of cart) {
    const questions = questionsByTier[line.ticketTypeId] ?? [];
    if (questions.length === 0) continue;
    for (let i = 0; i < line.qty; i++) {
      slots.push({
        key: ticketSlotKey(line.ticketTypeId, i),
        ticketTypeId: line.ticketTypeId,
        ticketTypeName: line.ticketTypeName,
        index: i,
        questions,
      });
    }
  }
  return slots;
}

// Client-side: validate every slot's answers and build the checkout body
// payload. `valuesBySlot` maps a slot key to its raw answer values (keyed
// by fieldKey, exactly what CheckoutQuestionFields writes). Errors are
// returned per slot so the storefront can show them under the right block.
export function collectTicketAnswers(
  slots: TicketQuestionSlot[],
  valuesBySlot: Record<string, Record<string, unknown>>
): {
  valid: boolean;
  errors: Record<string, Record<string, string>>;
  payload: Array<{ ticket_type_id: string; answers: Record<string, unknown> }>;
} {
  const errors: Record<string, Record<string, string>> = {};
  const payload: Array<{
    ticket_type_id: string;
    answers: Record<string, unknown>;
  }> = [];
  for (const slot of slots) {
    const values = valuesBySlot[slot.key] ?? {};
    const v = validateCheckoutAnswers(slot.questions, values);
    if (!v.valid) errors[slot.key] = v.errors;
    payload.push({ ticket_type_id: slot.ticketTypeId, answers: values });
  }
  return { valid: Object.keys(errors).length === 0, errors, payload };
}

// Server-side authority: rebuild the expected slots from the resolved
// cart lines (never trust client-declared counts), match the provided
// answers per tier in order, validate, and snapshot into the storable
// groups. Enforces required answers even if the client omits a slot.
export function buildTicketAnswerGroups(
  resolved: Array<{ ticketTypeId: string; qty: number; questions: FormField[] }>,
  provided: Array<{ ticket_type_id?: string; answers?: Record<string, unknown> }>
): {
  valid: boolean;
  error?: string;
  groups: TicketAnswerGroup[];
} {
  // FIFO queue of provided answer-maps per tier.
  const queues = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of provided) {
    const id = entry?.ticket_type_id;
    if (!id) continue;
    const answers =
      entry.answers && typeof entry.answers === "object" ? entry.answers : {};
    const q = queues.get(id) ?? [];
    q.push(answers);
    queues.set(id, q);
  }

  const groups: TicketAnswerGroup[] = [];
  for (const line of resolved) {
    if (line.questions.length === 0) continue;
    const q = queues.get(line.ticketTypeId) ?? [];
    for (let i = 0; i < line.qty; i++) {
      const values = q.shift() ?? {};
      const v = validateCheckoutAnswers(line.questions, values);
      if (!v.valid) {
        return {
          valid: false,
          error: "Please answer the required questions for each ticket.",
          groups: [],
        };
      }
      groups.push({
        ticket_type_id: line.ticketTypeId,
        answers: snapshotAnswers(line.questions, values),
      });
    }
  }
  return { valid: true, groups };
}

// Fulfilment: given the order's stored ticket_answers groups, hand back a
// function that yields the next snapshot for a given tier (FIFO). Tiers
// without questions — or once a tier's groups are exhausted — yield an
// empty array, which is a valid "no answers" ticket.
export function ticketAnswerDrainer(
  groups: TicketAnswerGroup[] | null | undefined
): (ticketTypeId: string) => CheckoutAnswerSnapshot[] {
  const queues = new Map<string, CheckoutAnswerSnapshot[][]>();
  for (const g of groups ?? []) {
    if (!g || typeof g.ticket_type_id !== "string") continue;
    const q = queues.get(g.ticket_type_id) ?? [];
    q.push(Array.isArray(g.answers) ? g.answers : []);
    queues.set(g.ticket_type_id, q);
  }
  return (ticketTypeId: string) => queues.get(ticketTypeId)?.shift() ?? [];
}
