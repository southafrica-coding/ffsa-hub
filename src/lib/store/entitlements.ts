// ============================================================
// Store — who may read what
// ============================================================
// An entitlement is "this email may read this product", from a purchase,
// a redeemed gift / pack code, or a staff grant. Pure rules here; the
// library and page routes load rows and ask.
// ============================================================

import type { StoreEntitlement, StoreProduct } from "./types";

export function isEntitlementActive(e: Pick<StoreEntitlement, "starts_at" | "expires_at" | "revoked_at">, now = new Date()): boolean {
  if (e.revoked_at) return false;
  if (new Date(e.starts_at) > now) return false;
  if (e.expires_at && new Date(e.expires_at) <= now) return false;
  return true;
}

export type Access = { read: boolean; pdf: boolean; expiresAt: string | null };

/**
 * What a reader may do with one product, across all their entitlements.
 * Matching is by signed-in user id or by verified email (a gift lands on an
 * email before its owner ever signs in).
 */
export function accessFor(
  entitlements: StoreEntitlement[],
  who: { userId: string | null; email: string },
  productId: string,
  now = new Date()
): Access {
  const email = who.email.toLowerCase();
  const mine = entitlements.filter(
    (e) => e.product_id === productId && (e.email === email || (!!who.userId && e.user_id === who.userId)) && isEntitlementActive(e, now)
  );
  if (mine.length === 0) return { read: false, pdf: false, expiresAt: null };
  const forever = mine.some((e) => !e.expires_at);
  const latest = forever ? null : mine.map((e) => e.expires_at!).sort().at(-1)!;
  return { read: true, pdf: mine.some((e) => e.includes_pdf), expiresAt: latest };
}

// ────────────────────────────────────────────────────────────
// PDF downloads — 3 per Print + Digital entitlement
// ────────────────────────────────────────────────────────────

export const PDF_DOWNLOAD_LIMIT = 3;
export const PDF_DOWNLOADS_USED_UP = "You've used all 3 downloads for this purchase. You can still read it in your library.";

/** The reader's active PDF entitlements for one product, oldest first (the order downloads are taken in). */
export function pdfEntitlementsFor(
  entitlements: StoreEntitlement[],
  who: { userId: string | null; email: string },
  productId: string,
  now = new Date()
): StoreEntitlement[] {
  const email = who.email.toLowerCase();
  return entitlements
    .filter(
      (e) =>
        e.product_id === productId &&
        e.includes_pdf &&
        (e.email === email || (!!who.userId && e.user_id === who.userId)) &&
        isEntitlementActive(e, now)
    )
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}

/** Downloads left across those entitlements: 3 per entitlement, less what each has used. */
export function pdfDownloadsLeft(pdfEntitlements: Pick<StoreEntitlement, "pdf_downloads_used">[]): number {
  return pdfEntitlements.reduce((n, e) => n + Math.max(0, PDF_DOWNLOAD_LIMIT - (e.pdf_downloads_used ?? 0)), 0);
}

/** When a subscription bought now runs out. Renewing early extends from the current end. */
export function subscriptionEnd(months: number, from: Date, currentEnd?: Date | null): Date {
  const base = currentEnd && currentEnd > from ? new Date(currentEnd) : new Date(from);
  const end = new Date(base);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}

export function entitlementShape(product: Pick<StoreProduct, "kind" | "subscription_months">, now: Date, currentEnd?: Date | null) {
  return {
    includes_pdf: product.kind === "bundle",
    starts_at: now.toISOString(),
    expires_at:
      product.kind === "subscription" && product.subscription_months
        ? subscriptionEnd(product.subscription_months, now, currentEnd).toISOString()
        : null,
  };
}
