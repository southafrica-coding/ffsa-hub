// ============================================================
// Store — checking a coupon against a priced cart, on the server
// ============================================================
// Shared by /api/store/coupon/validate, /api/store/quote and checkout.
// Reads the coupon with the service role (buyers can't read coupons) and
// decides with the pure rules in ./coupons. Guesses are rate-limited per IP
// on one shared bucket, so the quote route can't be used to try codes
// faster than validate can.
// ============================================================

import "server-only";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { getCouponByCode } from "@/services/store";
import { checkCoupon, COUPON_ERRORS, normaliseCouponCode, type CouponCheck, type StoreCoupon } from "./coupons";
import type { PricedCart } from "./cart";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const COUPON_RATE_LIMIT = { limit: 30, windowSeconds: 600 };

/** One hit on the shared coupon bucket for this IP. False = slow down. */
export async function couponGuessAllowed(request: Request): Promise<boolean> {
  const hit = await getRateLimiter().hit(`store-coupon:ip:${clientIp(request)}`, COUPON_RATE_LIMIT);
  return hit.allowed;
}

export type ServerCouponCheck = CouponCheck | { ok: false; reason: "unavailable"; error: string };

/** Normalise, load, check. Never returns database text. */
export async function checkCouponCode(admin: Client, rawCode: string, cart: PricedCart, now = new Date()): Promise<ServerCouponCheck> {
  const code = normaliseCouponCode(rawCode);
  if (!code) return { ok: false, reason: "malformed", error: COUPON_ERRORS.malformed };
  const { data, error } = await getCouponByCode(admin, code);
  if (error) {
    console.error("[store/coupon] lookup failed", error.code ?? "", error.message ?? "");
    return { ok: false, reason: "unavailable", error: "We couldn't check that code just now. Try again." };
  }
  return checkCoupon((data ?? null) as StoreCoupon | null, cart, now);
}
