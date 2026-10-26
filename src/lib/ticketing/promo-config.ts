// ============================================================
// Promo code admin config — validation (migrations 057, 269)
// ============================================================
// One validator for both create (POST) and edit (PATCH): an edit is
// merged over the stored row and the whole result re-validated, so a
// code can never be saved in a shape checkout can't make sense of
// (e.g. a percent code with no percent, or a waived question that sits
// outside the code's tier scope).
// ============================================================

import type { FormField } from "@/lib/forms/schema";
import {
  isPromoKind,
  sanitizeWaivedQuestions,
  type PromoKind,
  type WaivedQuestionRef,
} from "@/lib/ticketing/promo-codes";

export type PromoConfigInput = {
  code?: unknown;
  kind?: unknown;
  percent_off?: unknown;
  amount_off_cents?: unknown;
  applies_to_ticket_type_id?: unknown;
  max_redemptions?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
  is_active?: unknown;
  waives_waiver?: unknown;
  waived_questions?: unknown;
};

export type PromoConfig = {
  code: string;
  kind: PromoKind;
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
  max_redemptions: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  waives_waiver: boolean;
  waived_questions: WaivedQuestionRef[];
};

export const PROMO_CODE_MAX_LENGTH = 64;

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function parseOptionalDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d.toISOString() };
}

export function validatePromoConfig(
  input: PromoConfigInput,
  tiers: Array<{ id: string; questions: FormField[] | null }>
): { ok: true; config: PromoConfig } | { ok: false; error: string } {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!code) return { ok: false, error: "Code is required." };
  if (code.length > PROMO_CODE_MAX_LENGTH) {
    return { ok: false, error: `Code must be ${PROMO_CODE_MAX_LENGTH} characters or fewer.` };
  }
  if (/\s/.test(code)) return { ok: false, error: "Code can't contain spaces." };

  if (!isPromoKind(input.kind)) {
    return { ok: false, error: "kind must be 'percent', 'fixed_amount', 'comp' or 'none'." };
  }
  const kind = input.kind;

  let percentOff: number | null = null;
  let amountOffCents: number | null = null;
  if (kind === "percent") {
    if (!isPositiveInt(input.percent_off) || input.percent_off > 100) {
      return { ok: false, error: "Percent off must be a whole number from 1 to 100." };
    }
    percentOff = input.percent_off;
  } else if (kind === "fixed_amount") {
    if (!isPositiveInt(input.amount_off_cents)) {
      return { ok: false, error: "Amount off must be greater than 0." };
    }
    amountOffCents = input.amount_off_cents;
  }

  let scope: string | null = null;
  if (input.applies_to_ticket_type_id != null && input.applies_to_ticket_type_id !== "") {
    if (
      typeof input.applies_to_ticket_type_id !== "string" ||
      !tiers.some((t) => t.id === input.applies_to_ticket_type_id)
    ) {
      return { ok: false, error: "That ticket type isn't on this event." };
    }
    scope = input.applies_to_ticket_type_id;
  }

  let maxRedemptions: number | null = null;
  if (input.max_redemptions != null && input.max_redemptions !== "") {
    if (!isPositiveInt(input.max_redemptions)) {
      return { ok: false, error: "Max redemptions must be a whole number of at least 1." };
    }
    maxRedemptions = input.max_redemptions;
  }

  const from = parseOptionalDate(input.valid_from);
  const until = parseOptionalDate(input.valid_until);
  if (!from.ok || !until.ok) return { ok: false, error: "Validity dates must be valid dates." };
  if (from.value && until.value && new Date(from.value) >= new Date(until.value)) {
    return { ok: false, error: "'Valid until' must be after 'valid from'." };
  }

  if (input.waives_waiver != null && typeof input.waives_waiver !== "boolean") {
    return { ok: false, error: "waives_waiver must be true or false." };
  }
  const waivesWaiver = input.waives_waiver === true;

  const waived = sanitizeWaivedQuestions(input.waived_questions, tiers, scope);
  if (!waived.ok) return { ok: false, error: waived.error };

  if (kind === "none" && !waivesWaiver && waived.refs.length === 0) {
    return {
      ok: false,
      error: "A code with no discount has to waive the waiver or at least one question.",
    };
  }

  return {
    ok: true,
    config: {
      code,
      kind,
      percent_off: percentOff,
      amount_off_cents: amountOffCents,
      applies_to_ticket_type_id: scope,
      max_redemptions: maxRedemptions,
      valid_from: from.value,
      valid_until: until.value,
      is_active: input.is_active !== false,
      waives_waiver: waivesWaiver,
      waived_questions: waived.refs,
    },
  };
}
