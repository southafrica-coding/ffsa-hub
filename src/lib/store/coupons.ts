// ============================================================
// Store — coupon codes (migration 413)
// ============================================================
// Pure rules, safe to import in the browser: what a code looks like, what
// it takes off a priced cart, and the copy for every refusal. The server
// recomputes all of it at checkout; public.store_apply_coupon applies the
// same rule again inside the database when it takes the use.
//
// The rule:
//   * merchandise only, never delivery;
//   * a product-scoped code counts only that product's lines;
//   * percent: floor(eligible × percent / 100), in integer cents;
//   * amount: min(amount, eligible);
//   * total = subtotal + delivery − discount, never below zero.
// ============================================================

import { z } from "zod";
import { formatZar } from "./money";

export const COUPON_CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
export const COUPON_CODE_MIN = 3;
export const COUPON_CODE_MAX = 40;

/** Smallest card charge we send to each provider, in cents. PayFast's floor
 *  is R5.00; Stripe's depends on the account's settlement currency, so we
 *  stay well clear of it. Below these, a total that isn't R0 can only be
 *  paid by EFT. */
export const PROVIDER_MIN_CENTS = { payfast: 500, stripe: 2000 } as const;

export type StoreCoupon = {
  id: string;
  code: string;
  description: string | null;
  percent_off: number | null;
  amount_off_cents: number | null;
  product_id: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  active: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CouponRefusal = "malformed" | "unknown" | "inactive" | "expired" | "used_up" | "wrong_product" | "changed";

/** One calm line per refusal. Shared by validate, quote and checkout. */
export const COUPON_ERRORS: Record<CouponRefusal, string> = {
  malformed: "That doesn't look like a code. Codes are letters and numbers, like WELCOME20.",
  unknown: "We don't recognise that code. Check the spelling and try again.",
  inactive: "That code isn't on at the moment.",
  expired: "That code has expired.",
  used_up: "That code has been used as many times as it can be.",
  wrong_product: "That code is for something that isn't in your cart.",
  changed: "That code changed just now. Check your total and try again.",
};

/** Trim and upper-case. Null when it can't be a code. */
export function normaliseCouponCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (code.length < COUPON_CODE_MIN || code.length > COUPON_CODE_MAX) return null;
  return COUPON_CODE_RE.test(code) ? code : null;
}

/** An optional code field on a request: blank means no code. */
export const couponCodeField = z
  .string()
  .max(80)
  .optional()
  .nullable()
  .transform((s) => (s && s.trim() ? s : null));

/** "20% off" / "R 50 off". */
export function describeDiscount(c: Pick<StoreCoupon, "percent_off" | "amount_off_cents">): string {
  if (c.percent_off != null) return c.percent_off === 100 ? "Free" : `${c.percent_off}% off`;
  return `${formatZar(c.amount_off_cents ?? 0)} off`;
}

type CartForCoupon = {
  lines: Array<{ product: { id: string; title: string }; lineTotalCents: number }>;
  subtotalCents: number;
  deliveryCents: number;
};

/** What the code takes off this cart, in cents. Pure arithmetic: whether the
 *  code may be used at all is checkCoupon's job. */
export function couponDiscount(
  coupon: Pick<StoreCoupon, "percent_off" | "amount_off_cents" | "product_id">,
  cart: CartForCoupon
): { eligibleCents: number; discountCents: number } {
  const eligibleLines = coupon.product_id ? cart.lines.filter((l) => l.product.id === coupon.product_id) : cart.lines;
  const eligibleCents = Math.min(
    eligibleLines.reduce((s, l) => s + l.lineTotalCents, 0),
    cart.subtotalCents
  );
  let discountCents: number;
  if (coupon.percent_off != null) discountCents = Math.floor((eligibleCents * coupon.percent_off) / 100);
  else discountCents = Math.min(coupon.amount_off_cents ?? 0, eligibleCents);
  return { eligibleCents, discountCents: Math.max(0, discountCents) };
}

export type CouponCheck =
  | {
      ok: true;
      coupon: StoreCoupon;
      discountCents: number;
      totalCents: number;
      /** e.g. "WELCOME20: 20% off. You save R 30." */
      summary: string;
    }
  | { ok: false; reason: CouponRefusal; error: string };

/** Can this code be used on this cart right now, and what does it save. */
export function checkCoupon(
  coupon: StoreCoupon | null,
  cart: CartForCoupon,
  now: Date = new Date()
): CouponCheck {
  const refuse = (reason: CouponRefusal): CouponCheck => ({ ok: false, reason, error: COUPON_ERRORS[reason] });
  if (!coupon) return refuse("unknown");
  if (!coupon.active) return refuse("inactive");
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now.getTime()) return refuse("expired");
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) return refuse("used_up");
  if (coupon.product_id && !cart.lines.some((l) => l.product.id === coupon.product_id)) return refuse("wrong_product");

  const { discountCents } = couponDiscount(coupon, cart);
  const totalCents = Math.max(0, cart.subtotalCents + cart.deliveryCents - discountCents);
  const scope = coupon.product_id ? ` on ${cart.lines.find((l) => l.product.id === coupon.product_id)?.product.title}` : "";
  const summary =
    totalCents === 0
      ? `${coupon.code}: ${describeDiscount(coupon)}${scope}. There's nothing to pay.`
      : `${coupon.code}: ${describeDiscount(coupon)}${scope}. You save ${formatZar(discountCents)}.`;
  return { ok: true, coupon, discountCents, totalCents, summary };
}

/** Card providers that can take this total. R0 never goes to a provider. */
export function providerCanCharge(method: "payfast" | "stripe", totalCents: number): boolean {
  return totalCents >= PROVIDER_MIN_CENTS[method];
}

// ────────────────────────────────────────────────────────────
// Admin input
// ────────────────────────────────────────────────────────────

const adminSchema = z.object({
  code: z.string(),
  description: z.string().trim().max(200).optional().nullable(),
  discount_type: z.enum(["percent", "amount"]),
  percent_off: z.number().int().min(1).max(100).optional().nullable(),
  amount_off_cents: z.number().int().min(1).max(100_000_000).optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  max_uses: z.number().int().min(1).max(1_000_000).optional().nullable(),
  expires_at: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export type CouponRow = {
  code: string;
  description: string | null;
  percent_off: number | null;
  amount_off_cents: number | null;
  product_id: string | null;
  max_uses: number | null;
  expires_at: string | null;
  active: boolean;
};

/** Staff create / edit form → the row to write. Exactly one discount. */
export function normaliseCouponInput(raw: unknown): { ok: true; row: CouponRow } | { ok: false; error: string } {
  const parsed = adminSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const copy: Record<string, string> = {
      percent_off: "Percent off is a whole number from 1 to 100.",
      amount_off_cents: "Amount off should be more than R 0.",
      max_uses: "Max uses is a whole number, 1 or more. Leave it blank for no limit.",
      product_id: "Pick a product from the list, or All products.",
      description: "Keep the note under 200 characters.",
    };
    return { ok: false, error: copy[field] ?? "Check the form and try again." };
  }
  const v = parsed.data;
  const code = normaliseCouponCode(v.code);
  if (!code) return { ok: false, error: "Codes are 3 to 40 letters and numbers, with single hyphens between parts, like WELCOME20 or FRIEND-100." };
  if (v.discount_type === "percent" && v.percent_off == null) return { ok: false, error: "Add the percent off." };
  if (v.discount_type === "amount" && v.amount_off_cents == null) return { ok: false, error: "Add the amount off." };

  let expires: string | null = null;
  if (v.expires_at) {
    const t = new Date(v.expires_at);
    if (Number.isNaN(t.getTime())) return { ok: false, error: "Check the expiry date." };
    expires = t.toISOString();
  }
  return {
    ok: true,
    row: {
      code,
      description: v.description?.trim() || null,
      percent_off: v.discount_type === "percent" ? v.percent_off! : null,
      amount_off_cents: v.discount_type === "amount" ? v.amount_off_cents! : null,
      product_id: v.product_id ?? null,
      max_uses: v.max_uses ?? null,
      expires_at: expires,
      active: v.active ?? true,
    },
  };
}

/** What can't change once a code has been used. */
export function lockedChange(before: StoreCoupon, after: CouponRow): string | null {
  if (before.used_count === 0) return null;
  if (after.code !== before.code) return "This code has been used, so it can't be renamed. Make a new code instead.";
  if (after.percent_off !== before.percent_off || after.amount_off_cents !== before.amount_off_cents || after.product_id !== before.product_id) {
    return "This code has been used, so its discount and product stay as they are. Turn it off and make a new code instead.";
  }
  return null;
}

/** Calm copy for a database refusal on a coupon write. Never the raw text. */
export function couponWriteError(error: { code?: string; message?: string } | null | undefined): { status: number; error: string } {
  const msg = error?.message ?? "";
  if (error?.code === "23505" || /duplicate|unique/i.test(msg)) return { status: 409, error: "Another coupon already uses that code." };
  if (/store_coupons_within_max_check/.test(msg)) return { status: 409, error: "Max uses can't be lower than the number of times it's been used." };
  if (/store_coupon_locked/.test(msg)) return { status: 409, error: "This code has been used, so its code, discount and product stay as they are." };
  if (error?.code === "23503") return { status: 400, error: "That product isn't in the Store any more." };
  return { status: 500, error: "We couldn't save the coupon. Try again." };
}
