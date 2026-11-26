// ============================================================
// Store — PayFast (sandbox) + EFT
// ============================================================
// Reuses the shared adapter in src/lib/payments/payfast.ts (one signature
// implementation). The Store adds its own switches on top:
//   * STORE_PAYMENTS_ENABLED=1 opens checkout at all (default off).
//   * PayFast for the Store runs only while PAYFAST_MODE is sandbox, unless
//     STORE_PAYFAST_ALLOW_LIVE=1 is set on purpose later. This PR never sets it.
//   * EFT needs the STORE_EFT_* bank details.
// The ITN, never the buyer's return URL, decides an order is paid.
// ============================================================

import type { PaymentStatus } from "@/lib/payments/provider";
import { storePaymentsEnabled, storePayfastIsSandbox } from "./flags";

export function storePayfastAllowed(): { ok: true } | { ok: false; reason: string } {
  if (!storePaymentsEnabled()) return { ok: false, reason: "Checkout isn't open yet." };
  if (!storePayfastIsSandbox() && process.env.STORE_PAYFAST_ALLOW_LIVE !== "1") {
    return { ok: false, reason: "Card payments for the Store are in test mode only." };
  }
  if (!process.env.PAYFAST_MERCHANT_ID || !process.env.PAYFAST_MERCHANT_KEY) {
    return { ok: false, reason: "Card payments aren't set up yet. Choose EFT." };
  }
  return { ok: true };
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() ?? full;
  return { firstName, lastName: parts.join(" ") || firstName };
}

export type ItnOutcome =
  | "ignored-disabled"
  | "rejected"
  | "unknown-order"
  | "amount-mismatch"
  | "amount-missing"
  | "settled"
  | "already"
  | "cancelled"
  | "noop"
  | "error";

export type ItnDeps = {
  paymentsEnabled: () => boolean;
  verify: (rawBody: string) => Promise<{ orderId: string; status: PaymentStatus; providerPaymentId: string | null; amountCents: number | null }>;
  loadOrder: (id: string) => Promise<{ id: string; status: string; total_cents: number; payment_method: string } | null>;
  settle: (orderId: string, providerPaymentId: string | null) => Promise<"settled" | "already" | "error">;
  cancel: (orderId: string) => Promise<void>;
  log?: (msg: string) => void;
};

/**
 * Handle one Store ITN. Always ends in a 200 to PayFast (it doesn't act on
 * codes); the outcome is for logs and tests.
 */
export async function handleStoreItn(deps: ItnDeps, rawBody: string): Promise<ItnOutcome> {
  const log = deps.log ?? ((m: string) => console.error(m));
  if (!deps.paymentsEnabled()) {
    log("[store/itn] ignored: STORE_PAYMENTS_ENABLED is off");
    return "ignored-disabled";
  }
  let result;
  try {
    result = await deps.verify(rawBody);
  } catch (e) {
    log(`[store/itn] verification failed: ${e instanceof Error ? e.message : String(e)}`);
    return "rejected";
  }
  const order = await deps.loadOrder(result.orderId);
  if (!order || order.payment_method !== "payfast") {
    log(`[store/itn] no PayFast store order ${result.orderId}`);
    return "unknown-order";
  }
  // Fail closed: an ITN that carries an amount must match the order exactly,
  // and a "paid" ITN must carry one. A missing or unparseable amount_gross
  // never settles.
  const amount = result.amountCents;
  const hasAmount = typeof amount === "number" && Number.isInteger(amount);
  if (amount != null && (!hasAmount || amount !== order.total_cents)) {
    log(`[store/itn] amount mismatch on ${order.id}: expected ${order.total_cents}, got ${amount}`);
    return "amount-mismatch";
  }
  if (result.status === "paid") {
    if (!hasAmount) {
      log(`[store/itn] refusing to settle ${order.id}: no amount_gross on a paid ITN`);
      return "amount-missing";
    }
    return deps.settle(order.id, result.providerPaymentId);
  }
  if ((result.status === "cancelled" || result.status === "failed") && order.status === "pending") {
    await deps.cancel(order.id);
    return "cancelled";
  }
  return "noop";
}
