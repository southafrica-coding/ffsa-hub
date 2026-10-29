// ============================================================
// Promo codes — shared model + logic (migrations 057, 269)
// ============================================================
// A promo code can take money off the in-scope tickets AND waive
// process steps on them: the tier's signable waiver (waivers.ts) and
// any of the tier's per-ticket questions (ticket-questions.ts).
//
// Scope: a code restricted to one tier (applies_to_ticket_type_id)
// discounts and waives on that tier's tickets only; an any-tier code
// applies to every ticket in the order. The donation add-on is never
// discounted.
//
// Pure (no React, no DB) so the storefronts, the validate preview, the
// checkout route and fulfilment all share one source of truth. The
// checkout route is the authority — it re-runs everything here against
// the code it loads itself, never the client's copy of the terms.
// ============================================================

import type { FormField } from "@/lib/forms/schema";
import { isWaiverActive, type TierWaiver } from "@/lib/ticketing/waivers";

export type PromoKind = "percent" | "fixed_amount" | "comp" | "none";

export const PROMO_KINDS: PromoKind[] = ["percent", "fixed_amount", "comp", "none"];

// One per-ticket question a code skips. Qualified by tier because a
// question id is only unique within its tier's schema.
export type WaivedQuestionRef = { ticket_type_id: string; question_id: string };

// What the storefront needs to price the cart and hide waived steps.
// Returned by /promo/validate; also the shape the checkout route works
// from after loading the row.
export type PromoTerms = {
  code: string;
  kind: PromoKind;
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
  waives_waiver: boolean;
  waived_questions: WaivedQuestionRef[];
};

// Body of POST /api/events/[id]/promo/validate.
export type PromoValidateResponse =
  | ({ ok: true } & PromoTerms)
  | { ok: false; error?: string; tier_restricted?: boolean };

// The redeemability columns of a promo_codes row.
export type PromoAvailability = {
  is_active: boolean;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: string | null;
  valid_until: string | null;
};

// Stored on orders.waived_steps — one entry per in-scope tier that had
// something to waive.
export type OrderWaivedSteps = {
  ticket_type_id: string;
  waiver: boolean;
  question_ids: string[];
};

// Stored on tickets.waived_steps.
export type TicketWaivedSteps = {
  promo_code: string;
  waiver: boolean;
  question_ids: string[];
};

// ── Parsing ─────────────────────────────────────────────────

export function isPromoKind(value: unknown): value is PromoKind {
  return typeof value === "string" && (PROMO_KINDS as string[]).includes(value);
}

export function parseWaivedQuestions(value: unknown): WaivedQuestionRef[] {
  if (!Array.isArray(value)) return [];
  const out: WaivedQuestionRef[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.ticket_type_id !== "string" || typeof r.question_id !== "string") continue;
    const key = `${r.ticket_type_id}:${r.question_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ticket_type_id: r.ticket_type_id, question_id: r.question_id });
  }
  return out;
}

// A promo_codes row (or the validate response) → PromoTerms. Unknown
// kinds degrade to 'none' so a bad row can never discount.
export function toPromoTerms(row: {
  code: string;
  kind: string;
  percent_off?: number | null;
  amount_off_cents?: number | null;
  applies_to_ticket_type_id?: string | null;
  waives_waiver?: boolean | null;
  waived_questions?: unknown;
}): PromoTerms {
  return {
    code: row.code,
    kind: isPromoKind(row.kind) ? row.kind : "none",
    percent_off: row.percent_off ?? null,
    amount_off_cents: row.amount_off_cents ?? null,
    applies_to_ticket_type_id: row.applies_to_ticket_type_id ?? null,
    waives_waiver: row.waives_waiver === true,
    waived_questions: parseWaivedQuestions(row.waived_questions),
  };
}

// Codes are matched case-insensitively with ILIKE, so a buyer typing
// "%" must not match every code on the event. Escape the wildcards.
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── Redeemability ───────────────────────────────────────────

// Why a code can't be redeemed right now, or null if it can. Shared by
// the validate preview and checkout so the buyer sees one message.
export function promoUnavailableReason(
  promo: PromoAvailability,
  now: Date
): string | null {
  if (!promo.is_active) return "That code isn't valid.";
  if (promo.valid_from && new Date(promo.valid_from) > now) {
    return "That code isn't active yet.";
  }
  if (promo.valid_until && new Date(promo.valid_until) <= now) {
    return "That code has expired.";
  }
  if (promo.max_redemptions != null && promo.redemption_count >= promo.max_redemptions) {
    return "That code has been fully redeemed.";
  }
  return null;
}

export function promoAppliesToTier(
  terms: Pick<PromoTerms, "applies_to_ticket_type_id">,
  ticketTypeId: string
): boolean {
  return !terms.applies_to_ticket_type_id || terms.applies_to_ticket_type_id === ticketTypeId;
}

// ── Discount math ───────────────────────────────────────────

// Integer cents off the order. Only in-scope tickets count towards the
// discountable amount; the result never exceeds it (so a fixed amount
// larger than the in-scope tickets just makes them free).
export function computePromoDiscount(
  terms: PromoTerms | null,
  lines: Array<{ ticketTypeId: string; qty: number; perTicketCents: number }>
): number {
  if (!terms) return 0;
  const eligible = lines
    .filter((l) => promoAppliesToTier(terms, l.ticketTypeId))
    .reduce((sum, l) => sum + Math.max(0, l.qty) * Math.max(0, l.perTicketCents), 0);
  if (eligible <= 0) return 0;
  switch (terms.kind) {
    case "percent": {
      const pct = Math.min(100, Math.max(0, terms.percent_off ?? 0));
      return Math.min(eligible, Math.round((eligible * pct) / 100));
    }
    case "fixed_amount":
      return Math.min(eligible, Math.max(0, terms.amount_off_cents ?? 0));
    case "comp":
      return eligible;
    default:
      return 0;
  }
}

// Storefront: the discount for the live cart. Mirrors the checkout
// route's per-ticket price (the buyer's PWYW amount, else the tier's
// display price) so the preview matches what checkout charges.
export function cartPromoDiscount(
  terms: PromoTerms | null,
  cart: Array<{ ticketTypeId: string; qty: number; pwywAmountCents: number | null }>,
  ticketTypes: Array<{ id: string; display_price_cents: number }>
): number {
  return computePromoDiscount(
    terms,
    cart.map((l) => ({
      ticketTypeId: l.ticketTypeId,
      qty: l.qty,
      perTicketCents:
        l.pwywAmountCents ??
        ticketTypes.find((t) => t.id === l.ticketTypeId)?.display_price_cents ??
        0,
    }))
  );
}

// ── Waived steps ────────────────────────────────────────────

export function isWaiverWaived(terms: PromoTerms | null, ticketTypeId: string): boolean {
  return !!terms && terms.waives_waiver && promoAppliesToTier(terms, ticketTypeId);
}

// The tier's waiver as the buyer must actually sign it — null when the
// code waives it.
export function waiverAfterPromo(
  waiver: TierWaiver | null | undefined,
  terms: PromoTerms | null,
  ticketTypeId: string
): TierWaiver | null {
  if (!waiver) return null;
  return isWaiverWaived(terms, ticketTypeId) ? null : waiver;
}

// Ids of the tier's questions the code skips, including every
// conditional child of a skipped question (a child can't be shown
// without its parent's answer).
export function waivedQuestionIdsForTier(
  questions: FormField[],
  terms: PromoTerms | null,
  ticketTypeId: string
): string[] {
  if (!terms || !promoAppliesToTier(terms, ticketTypeId)) return [];
  const waived = new Set(
    terms.waived_questions
      .filter((r) => r.ticket_type_id === ticketTypeId)
      .map((r) => r.question_id)
  );
  if (waived.size === 0) return [];
  // Walk descendants until nothing new is added (handles any order).
  let grew = true;
  while (grew) {
    grew = false;
    for (const q of questions) {
      if (!waived.has(q.id) && q.parentFieldId && waived.has(q.parentFieldId)) {
        waived.add(q.id);
        grew = true;
      }
    }
  }
  return questions.filter((q) => waived.has(q.id)).map((q) => q.id);
}

// The tier's questions as the buyer must actually answer them.
export function questionsAfterPromo(
  questions: FormField[],
  terms: PromoTerms | null,
  ticketTypeId: string
): FormField[] {
  const waived = new Set(waivedQuestionIdsForTier(questions, terms, ticketTypeId));
  return waived.size === 0 ? questions : questions.filter((q) => !waived.has(q.id));
}

// Per-tier record of what the code actually waived on this order. Only
// steps the tier really has are recorded — waiving a waiver on a tier
// without one isn't a waiver.
export function computeOrderWaivedSteps(
  terms: PromoTerms | null,
  tiers: Array<{
    ticketTypeId: string;
    questions: FormField[];
    waiverActive: boolean;
  }>
): OrderWaivedSteps[] {
  if (!terms) return [];
  const out: OrderWaivedSteps[] = [];
  for (const t of tiers) {
    const waiver = t.waiverActive && isWaiverWaived(terms, t.ticketTypeId);
    const questionIds = waivedQuestionIdsForTier(t.questions, terms, t.ticketTypeId);
    if (!waiver && questionIds.length === 0) continue;
    out.push({ ticket_type_id: t.ticketTypeId, waiver, question_ids: questionIds });
  }
  return out;
}

// Fulfilment: what to stamp on each issued ticket of a tier.
export function ticketWaivedSteps(
  orderSteps: OrderWaivedSteps[] | null | undefined,
  promoCode: string | null | undefined,
  ticketTypeId: string
): TicketWaivedSteps | null {
  if (!promoCode || !Array.isArray(orderSteps)) return null;
  const s = orderSteps.find((x) => x && x.ticket_type_id === ticketTypeId);
  if (!s) return null;
  return {
    promo_code: promoCode,
    waiver: s.waiver === true,
    question_ids: Array.isArray(s.question_ids) ? s.question_ids : [],
  };
}

// ── Admin config ────────────────────────────────────────────

// Validate an admin's waiver picks against the event's real tiers: every
// referenced tier must exist and be inside the code's scope, every
// question must exist on that tier. Returns a clean, de-duplicated list.
export function sanitizeWaivedQuestions(
  input: unknown,
  tiers: Array<{ id: string; questions: FormField[] | null }>,
  scopeTicketTypeId: string | null
): { ok: true; refs: WaivedQuestionRef[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, refs: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "waived_questions must be an array" };
  }
  const malformed = input.some(
    (v) =>
      !v ||
      typeof v !== "object" ||
      typeof (v as Record<string, unknown>).ticket_type_id !== "string" ||
      typeof (v as Record<string, unknown>).question_id !== "string"
  );
  if (malformed) {
    return { ok: false, error: "waived_questions entries need ticket_type_id and question_id" };
  }
  const refs = parseWaivedQuestions(input);
  const byId = new Map(tiers.map((t) => [t.id, t]));
  for (const r of refs) {
    const tier = byId.get(r.ticket_type_id);
    if (!tier) return { ok: false, error: "A waived question belongs to a tier not on this event" };
    if (scopeTicketTypeId && r.ticket_type_id !== scopeTicketTypeId) {
      return { ok: false, error: "Waived questions must be on the tier the code is restricted to" };
    }
    if (!(tier.questions ?? []).some((q) => q.id === r.question_id)) {
      return { ok: false, error: "A waived question no longer exists on its tier" };
    }
  }
  return { ok: true, refs };
}

// ── Copy ────────────────────────────────────────────────────

// "Skips the waiver and 2 questions" — for the storefront's applied-code
// line. Null when the code waives nothing in the current cart.
export function describeWaivedForCart(
  terms: PromoTerms | null,
  cart: Array<{ ticketTypeId: string }>,
  ticketTypes: Array<{
    id: string;
    questions?: FormField[] | null;
    waiver?: TierWaiver | null;
  }>
): string | null {
  const steps = computeOrderWaivedSteps(
    terms,
    cart.map((l) => {
      const tt = ticketTypes.find((t) => t.id === l.ticketTypeId);
      return {
        ticketTypeId: l.ticketTypeId,
        questions: tt?.questions ?? [],
        waiverActive: isWaiverActive(tt?.waiver),
      };
    })
  );
  if (steps.length === 0) return null;
  const waiver = steps.some((s) => s.waiver);
  const questions = new Set(
    steps.flatMap((s) => s.question_ids.map((q) => `${s.ticket_type_id}:${q}`))
  ).size;
  const parts: string[] = [];
  if (waiver) parts.push("the waiver");
  if (questions > 0) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);
  return `Skips ${parts.join(" and ")}`;
}
