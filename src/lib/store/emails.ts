// ============================================================
// Store — emails
// ============================================================
// HTML built on the canonical FFSA chrome (ffsa-chrome.ts), sent through
// sendTransactional (suppression-aware + ledgered). Nothing leaves unless
// STORE_EMAILS_ENABLED=1: until then each email is logged by subject only
// (no addresses, no links) and reported as skipped.
// ============================================================

import { feButton, feCoords, feEsc, feEyebrow, feHeading, feList, feNotice, feParagraph, ffsaEmailDocument } from "@/lib/email/ffsa-chrome";
import { formatZar } from "./money";
import { storeEmailsEnabled } from "./flags";
import { fulfilmentLabel } from "./settle";
import type { FulfilmentStatus, StoreOrder, StoreOrderItem } from "./types";

export type StoreEmail = { to: string; subject: string; html: string; category: string; sourceId?: string | null };

export type StoreEmailSender = (email: StoreEmail) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;

/** Default sender: flag-guarded sendTransactional. */
export const sendStoreEmail: StoreEmailSender = async (email) => {
  if (!storeEmailsEnabled()) {
    console.info(`[store/email] not sent (STORE_EMAILS_ENABLED is off): ${email.category}`);
    return { ok: true, skipped: true };
  }
  const { sendTransactional } = await import("@/lib/email/send-transactional");
  const res = await sendTransactional({
    to: email.to,
    subject: email.subject,
    html: email.html,
    category: email.category,
    sourceType: "store_order",
    sourceId: email.sourceId ?? null,
    reason: "Fire & Fragrance Store",
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
};

/** Where Media's notices go. Comma-separated; blank = no notice. */
export function mediaNotifyAddresses(): string[] {
  return (process.env.STORE_MEDIA_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

function doc(preview: string, body: string) {
  return ffsaEmailDocument({ previewText: preview, bodyHtml: body });
}

function itemLine(i: Pick<StoreOrderItem, "title" | "variant_label" | "quantity" | "purpose" | "gift_recipient_email">) {
  // Plain text: feList escapes.
  const what = `${i.title}${i.variant_label ? ` (${i.variant_label})` : ""}`;
  if (i.purpose === "gift") return `${what}, a gift for ${i.gift_recipient_email}`;
  if (i.purpose === "code_pack") return `${what}, a pack of ${i.quantity} codes`;
  return i.quantity > 1 ? `${what} × ${i.quantity}` : what;
}

export function orderConfirmationEmail(order: StoreOrder, items: StoreOrderItem[], links: { library: string; orders: string }) {
  const readable = items.some((i) => i.purpose === "self");
  const packs = items.some((i) => i.purpose === "code_pack");
  const body = [
    feEyebrow(`Order ${order.reference}`),
    feHeading("Thank you. It's yours."),
    feParagraph(`We've received ${formatZar(order.total_cents)} for your order.`),
    feList(items.map(itemLine)),
    readable ? feButton(links.library, "Open My Library") : "",
    packs ? feParagraph(`Your pack codes are on <a href="${feEsc(links.orders)}">your orders page</a>. Hand one to each reader.`) : "",
    order.fulfilment_method === "collect" ? feNotice("Collect at base", "We'll email you when it's ready to collect.") : "",
    order.fulfilment_method === "delivery" ? feNotice("Delivery", "We'll email you when it's on its way.") : "",
  ].join("");
  return { subject: `Your Fire & Fragrance order ${order.reference}`, html: doc("Your order is confirmed", body) };
}

export function eftInstructionsEmail(order: StoreOrder, bank: EftDetails, thanksUrl: string) {
  const body = [
    feEyebrow(`Order ${order.reference}`),
    feHeading("Pay by EFT"),
    feParagraph("Your order is held. Pay the amount below with the reference exactly as shown, and we'll confirm it once it reflects."),
    feCoords([
      { label: "Amount", value: formatZar(order.total_cents) },
      { label: "Reference", value: order.reference },
      { label: "Bank", value: bank.bank },
      { label: "Account name", value: bank.accountName },
      { label: "Account number", value: bank.accountNumber },
      { label: "Branch code", value: bank.branchCode },
    ]),
    feButton(thanksUrl, "See your order"),
  ].join("");
  return { subject: `Pay for order ${order.reference} by EFT`, html: doc("EFT details for your order", body) };
}

export function giftEmail(input: { fromName: string; title: string; code: string; message: string | null; redeemUrl: string }) {
  const body = [
    feEyebrow("A gift for you"),
    feHeading(`${input.fromName} sent you ${input.title}`),
    input.message ? feNotice("Their note", feEsc(input.message)) : "",
    feParagraph(`Your gift code is <strong>${feEsc(input.code)}</strong>.`),
    feButton(input.redeemUrl, "Claim your gift"),
    feParagraph("You'll read it in your browser. There's nothing to install."),
  ].join("");
  return { subject: `${input.fromName} sent you ${input.title}`, html: doc("A gift from Fire & Fragrance", body) };
}

export function fulfilmentEmail(order: Pick<StoreOrder, "reference">, status: FulfilmentStatus, tracking: string | null, ordersUrl: string) {
  const lines: Record<FulfilmentStatus, string> = {
    preorder: "Your preorder is in. We'll let you know when it ships.",
    to_pack: "We're packing your order now.",
    ready_to_collect: "Your order is ready. Collect it from reception at the base.",
    shipped: "Your order is on its way.",
    collected: "You've collected your order. Enjoy it.",
    delivered: "Your order has been delivered.",
  };
  const body = [
    feEyebrow(`Order ${order.reference}`),
    feHeading(fulfilmentLabel(status)),
    feParagraph(lines[status]),
    tracking ? feNotice("Tracking", feEsc(tracking)) : "",
    feButton(ordersUrl, "See your order"),
  ].join("");
  return { subject: `Order ${order.reference}: ${fulfilmentLabel(status).toLowerCase()}`, html: doc(lines[status], body) };
}

export function mediaNoticeEmail(order: StoreOrder, items: StoreOrderItem[], adminUrl: string, extra?: string) {
  const body = [
    feEyebrow("Store"),
    feHeading(`New paid order ${order.reference}`),
    feList(items.map(itemLine)),
    feCoords([
      { label: "Total", value: formatZar(order.total_cents) },
      { label: "Paid by", value: order.payment_method === "eft" ? "EFT" : order.payment_method === "stripe" ? "International card (Stripe)" : "Card (PayFast)" },
      { label: "Fulfilment", value: order.fulfilment_method === "none" ? "Digital only" : order.fulfilment_method === "collect" ? "Collect at base" : "Delivery" },
    ]),
    extra ? feNotice("Check this", feEsc(extra)) : "",
    feButton(adminUrl, "Open the order"),
  ].join("");
  return { subject: `Store: order ${order.reference} paid`, html: doc("A Store order was paid", body) };
}

export function purchasesEmail(orders: Array<{ reference: string; items: string[] }>, signInUrl: string) {
  const body = [
    feEyebrow("Your purchases"),
    feHeading("Everything you've bought"),
    ...orders.map((o) => feEyebrow(`Order ${o.reference}`) + feList(o.items)),
    feButton(signInUrl, "Open My Library"),
    feParagraph("This link signs you in and works once. It expires in an hour."),
  ].join("");
  return { subject: "Your Fire & Fragrance purchases", html: doc("Your purchases and a sign-in link", body) };
}

export function signInEmail(signInUrl: string) {
  const body = [
    feEyebrow("Store"),
    feHeading("Sign in to My Library"),
    feButton(signInUrl, "Sign in"),
    feParagraph("This link works once and expires in an hour. If you didn't ask for it, ignore this email."),
  ].join("");
  return { subject: "Your sign-in link for My Library", html: doc("Sign in to My Library", body) };
}

export type EftDetails = { bank: string; accountName: string; accountNumber: string; branchCode: string };

/** Bank details for EFT orders, from env. Null when they aren't set (EFT then stays off). */
export function eftDetails(): EftDetails | null {
  const bank = process.env.STORE_EFT_BANK?.trim();
  const accountName = process.env.STORE_EFT_ACCOUNT_NAME?.trim();
  const accountNumber = process.env.STORE_EFT_ACCOUNT_NUMBER?.trim();
  const branchCode = process.env.STORE_EFT_BRANCH_CODE?.trim();
  if (!bank || !accountName || !accountNumber || !branchCode) return null;
  return { bank, accountName, accountNumber, branchCode };
}
