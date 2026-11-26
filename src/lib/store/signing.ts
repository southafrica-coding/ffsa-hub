// ============================================================
// Store — short-lived signed page URLs
// ============================================================
// A page image is fetched as
//   /api/store/page?a=<asset>&p=<page>&v=<viewer>&e=<expiry>&s=<sig>
// The library route checks the buyer's entitlement and device, then signs
// one URL per page for PAGE_URL_TTL_SECONDS. The page route verifies the
// HMAC and expiry only (cheap, cache-friendly) and serves the clean stored
// page. `v` is "preview" for public previews, the buyer's email otherwise.
//
// The viewer is inside the signed payload, so a preview URL can't be edited
// into a link to a paid page.
// ============================================================

import { createHmac, timingSafeEqual } from "node:crypto";

export const PAGE_URL_TTL_SECONDS = 10 * 60;
export const PDF_URL_TTL_SECONDS = 120;

export const PREVIEW_VIEWER = "preview";

function secret(): string {
  const s = process.env.STORE_SIGNING_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("STORE_SIGNING_SECRET is not set (min 16 chars) — Store page links can't be signed.");
  }
  return "dev-only-store-signing-secret";
}

export type PageClaim = { assetId: string; page: number; viewer: string; expiresAt: number };

function payload(c: PageClaim): string {
  return `${c.assetId}|${c.page}|${c.viewer.toLowerCase()}|${c.expiresAt}`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signPage(claim: PageClaim, key = secret()): string {
  return b64url(createHmac("sha256", key).update(payload(claim)).digest());
}

export function pageUrl(
  input: { assetId: string; page: number; viewer: string },
  opts: { now?: number; ttlSeconds?: number; key?: string } = {}
): string {
  const now = opts.now ?? Date.now();
  const expiresAt = Math.floor(now / 1000) + (opts.ttlSeconds ?? PAGE_URL_TTL_SECONDS);
  const claim = { ...input, viewer: input.viewer.toLowerCase(), expiresAt };
  const q = new URLSearchParams({
    a: claim.assetId,
    p: String(claim.page),
    v: claim.viewer,
    e: String(expiresAt),
    s: signPage(claim, opts.key),
  });
  return `/api/store/page?${q.toString()}`;
}

export type VerifyResult = { ok: true; claim: PageClaim } | { ok: false; reason: "malformed" | "expired" | "bad-signature" };

export function verifyPageQuery(
  params: URLSearchParams,
  opts: { now?: number; key?: string } = {}
): VerifyResult {
  const assetId = params.get("a") ?? "";
  const page = Number(params.get("p"));
  const viewer = (params.get("v") ?? "").toLowerCase();
  const expiresAt = Number(params.get("e"));
  const sig = params.get("s") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || !Number.isInteger(page) || page < 1 || !viewer || !Number.isInteger(expiresAt) || !sig) {
    return { ok: false, reason: "malformed" };
  }
  const claim = { assetId, page, viewer, expiresAt };
  const expected = Buffer.from(signPage(claim, opts.key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad-signature" };
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (expiresAt < nowSec) return { ok: false, reason: "expired" };
  return { ok: true, claim };
}

// ────────────────────────────────────────────────────────────
// Order tokens — the thanks page and EFT proof upload
// ────────────────────────────────────────────────────────────
// An order's UUID alone is not a key. The thanks link (returned to the
// browser at checkout, used as PayFast's return_url and sent in the EFT
// email) carries an HMAC of the order id. The thanks page and the EFT proof
// upload accept either that token or a signed-in buyer who owns the order.

function orderPayload(orderId: string): string {
  return `store-order:${orderId.toLowerCase()}`;
}

export function signOrderToken(orderId: string, key = secret()): string {
  return b64url(createHmac("sha256", key).update(orderPayload(orderId)).digest());
}

export function verifyOrderToken(orderId: string, token: string | null | undefined, key?: string): boolean {
  if (!token || !/^[0-9a-f-]{36}$/i.test(orderId)) return false;
  const expected = Buffer.from(signOrderToken(orderId, key));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** /store/thanks?order=<id>&t=<token> */
export function thanksPath(orderId: string, key?: string): string {
  return `/store/thanks?${new URLSearchParams({ order: orderId, t: signOrderToken(orderId, key) }).toString()}`;
}

/** May this request act on this order? A valid token, or the signed-in buyer who placed it. */
export function canActOnOrder(
  order: { id: string; buyer_email: string; buyer_user_id: string | null },
  input: { token?: string | null; buyer?: { userId: string; email: string } | null },
  key?: string
): boolean {
  if (verifyOrderToken(order.id, input.token, key)) return true;
  const b = input.buyer;
  if (!b) return false;
  return (order.buyer_user_id != null && order.buyer_user_id === b.userId) || order.buyer_email === b.email.toLowerCase();
}
