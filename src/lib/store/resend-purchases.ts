// ============================================================
// Store — "Resend my purchases" / "Email me a sign-in link"
// ============================================================
// A buyer types their email. If it has paid orders we send ONE email
// listing every purchase with a sign-in link into My Library. Whatever
// happens, the response is the same neutral line, so the form can't be
// used to find out who has bought what.
//
// Limits: 3 per email per hour, 10 per IP per hour. Over a limit we stay
// neutral and send nothing.
//
// Dependencies are passed in so the rules can be tested without a
// database or a mail server.
// ============================================================

import type { RateLimiter } from "@/lib/rate-limit";
import { purchasesEmail, signInEmail, type StoreEmailSender } from "./emails";

export const NEUTRAL_RESEND_MESSAGE = "If that email has purchases, we've sent them.";
export const NEUTRAL_SIGNIN_MESSAGE = "If that email has bought from the Store, we've sent a sign-in link.";

export const RESEND_LIMITS = {
  perEmail: { limit: 3, windowSeconds: 3600 },
  perIp: { limit: 10, windowSeconds: 3600 },
};

export type PaidOrderSummary = {
  reference: string;
  items: Array<{ title: string; variant_label: string | null; quantity: number; purpose: string }>;
};

export type ResendDeps = {
  limiter: RateLimiter;
  findPaidOrders: (email: string) => Promise<PaidOrderSummary[]>;
  /** For sign-in: does this email have any order or entitlement at all? */
  hasAnyPurchase?: (email: string) => Promise<boolean>;
  makeSignInLink: (email: string) => Promise<string | null>;
  send: StoreEmailSender;
};

export type ResendResult = { message: string; sent: boolean; reason?: "invalid" | "limited" | "none" | "link-failed" | "send-failed" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function limited(deps: ResendDeps, kind: string, email: string, ip: string) {
  const [byEmail, byIp] = await Promise.all([
    deps.limiter.hit(`store-${kind}:email:${email}`, RESEND_LIMITS.perEmail),
    deps.limiter.hit(`store-${kind}:ip:${ip}`, RESEND_LIMITS.perIp),
  ]);
  return !byEmail.allowed || !byIp.allowed;
}

function describe(i: PaidOrderSummary["items"][number]): string {
  const what = `${i.title}${i.variant_label ? ` (${i.variant_label})` : ""}`;
  if (i.purpose === "gift") return `${what}, sent as a gift`;
  if (i.purpose === "code_pack") return `${what}, ${i.quantity} codes`;
  return i.quantity > 1 ? `${what} × ${i.quantity}` : what;
}

export async function resendPurchases(deps: ResendDeps, input: { email: unknown; ip: string }): Promise<ResendResult> {
  const message = NEUTRAL_RESEND_MESSAGE;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return { message, sent: false, reason: "invalid" };
  if (await limited(deps, "resend", email, input.ip)) return { message, sent: false, reason: "limited" };

  const orders = await deps.findPaidOrders(email);
  if (orders.length === 0) return { message, sent: false, reason: "none" };

  const link = await deps.makeSignInLink(email);
  if (!link) return { message, sent: false, reason: "link-failed" };

  const mail = purchasesEmail(
    orders.map((o) => ({ reference: o.reference, items: o.items.map(describe) })),
    link
  );
  const res = await deps.send({ to: email, subject: mail.subject, html: mail.html, category: "store_resend_purchases" });
  return { message, sent: res.ok && !res.skipped, reason: res.ok ? undefined : "send-failed" };
}

export async function sendSignInLink(deps: ResendDeps, input: { email: unknown; ip: string; next?: string }): Promise<ResendResult> {
  const message = NEUTRAL_SIGNIN_MESSAGE;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return { message, sent: false, reason: "invalid" };
  if (await limited(deps, "signin", email, input.ip)) return { message, sent: false, reason: "limited" };
  const has = deps.hasAnyPurchase ? await deps.hasAnyPurchase(email) : (await deps.findPaidOrders(email)).length > 0;
  if (!has) return { message, sent: false, reason: "none" };
  const link = await deps.makeSignInLink(email);
  if (!link) return { message, sent: false, reason: "link-failed" };
  const mail = signInEmail(link);
  const res = await deps.send({ to: email, subject: mail.subject, html: mail.html, category: "store_sign_in" });
  return { message, sent: res.ok && !res.skipped, reason: res.ok ? undefined : "send-failed" };
}
