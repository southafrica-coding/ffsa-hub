// ============================================================
// FFSA Hub — Store data access (migration 412)
// ============================================================
// Pure query construction, Client first, raw { data, error } back — the
// same shape as services/school-fees.ts. Business rules live in
// src/lib/store/*; the settle step at the bottom is the one place that
// strings several writes together, behind the pending → paid guard.
// ============================================================

import type { ProductRow } from "@/lib/store/catalogue";
import type { SettlementPlan } from "@/lib/store/settle";
import type { FulfilmentStatus, StoreOrder, StoreOrderItem, StoreProduct } from "@/lib/store/types";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PRODUCT_COLUMNS =
  "id, slug, title, subtitle, description, kind, status, price_cents, currency, cover_image_url, subscription_months, ships, allow_delivery, allow_collect, delivery_fee_cents, is_preorder, preorder_ships_on, allow_gift, allow_code_packs, sort_order, created_at, updated_at";

// ────────────────────────────────────────────────────────────
// Catalogue
// ────────────────────────────────────────────────────────────

export async function listPublishedProducts(supabase: Client) {
  return supabase
    .from("store_products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "published")
    .order("sort_order")
    .order("created_at", { ascending: false });
}

export async function listAllProducts(supabase: Client) {
  return supabase.from("store_products").select(PRODUCT_COLUMNS).order("sort_order").order("created_at", { ascending: false });
}

export async function getProductBySlug(supabase: Client, slug: string) {
  return supabase.from("store_products").select(PRODUCT_COLUMNS).eq("slug", slug).maybeSingle();
}

export async function getProduct(supabase: Client, id: string) {
  return supabase.from("store_products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle();
}

export async function getProductsByIds(supabase: Client, ids: string[]) {
  return supabase.from("store_products").select(PRODUCT_COLUMNS).in("id", ids);
}

export async function createProduct(supabase: Client, row: ProductRow & { created_by?: string | null }) {
  return supabase.from("store_products").insert(row).select(PRODUCT_COLUMNS).single();
}

export async function updateProduct(supabase: Client, id: string, row: Partial<ProductRow>) {
  return supabase
    .from("store_products")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(PRODUCT_COLUMNS)
    .single();
}

/** The product's background music path (store-audio bucket), if any. Not in PRODUCT_COLUMNS: only routes that need it read it. */
export async function getProductAudio(supabase: Client, id: string) {
  return supabase.from("store_products").select("id, audio_path").eq("id", id).maybeSingle();
}

export async function setProductAudio(supabase: Client, id: string, audioPath: string | null) {
  return supabase
    .from("store_products")
    .update({ audio_path: audioPath, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, audio_path")
    .single();
}

// ────────────────────────────────────────────────────────────
// Variants
// ────────────────────────────────────────────────────────────

export async function listVariants(supabase: Client, productIds: string[]) {
  return supabase.from("store_variants").select("*").in("product_id", productIds).order("sort_order");
}

export async function upsertVariant(
  supabase: Client,
  row: { id?: string; product_id: string; label: string; sku?: string | null; price_cents?: number | null; stock?: number | null; active?: boolean; sort_order?: number }
) {
  if (row.id) {
    const { id, ...rest } = row;
    return supabase.from("store_variants").update(rest).eq("id", id).eq("product_id", row.product_id).select("*").single();
  }
  return supabase.from("store_variants").insert(row).select("*").single();
}

export async function deleteVariant(supabase: Client, productId: string, id: string) {
  return supabase.from("store_variants").delete().eq("id", id).eq("product_id", productId);
}

// ────────────────────────────────────────────────────────────
// Assets + pages
// ────────────────────────────────────────────────────────────

export async function getActiveAsset(supabase: Client, productId: string) {
  return supabase.from("store_assets").select("*").eq("product_id", productId).eq("is_active", true).maybeSingle();
}

export async function listAssets(supabase: Client, productId: string) {
  return supabase.from("store_assets").select("*").eq("product_id", productId).order("created_at", { ascending: false });
}

export async function getAsset(supabase: Client, id: string) {
  return supabase.from("store_assets").select("*").eq("id", id).maybeSingle();
}

export async function createAsset(
  supabase: Client,
  row: { id: string; product_id: string; source_path: string; uploaded_by: string | null; filename?: string | null; byte_size?: number | null }
) {
  return supabase.from("store_assets").insert({ ...row, status: "awaiting_upload" }).select("*").single();
}

/** Move an asset into "rendering" only if it's in one of `from`. Returns
 *  the row, or null when someone else already claimed it. */
export async function claimAssetForRender(supabase: Client, id: string, from: string[]) {
  return supabase
    .from("store_assets")
    .update({ status: "rendering", error: null, page_count: 0, render_started_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from)
    .select("*")
    .maybeSingle();
}

export async function updateAsset(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("store_assets").update(patch).eq("id", id).select("*").single();
}

/** Make one asset the product's live one (the unique index allows one). */
export async function activateAsset(supabase: Client, productId: string, assetId: string) {
  const off = await supabase.from("store_assets").update({ is_active: false }).eq("product_id", productId).neq("id", assetId).eq("is_active", true);
  if (off.error) return off;
  return supabase.from("store_assets").update({ is_active: true }).eq("id", assetId).select("*").single();
}

export async function listPages(supabase: Client, assetId: string, opts: { previewOnly?: boolean } = {}) {
  let q = supabase.from("store_asset_pages").select("*").eq("asset_id", assetId).order("page_no");
  if (opts.previewOnly) q = q.eq("is_preview", true);
  return q;
}

export async function getPage(supabase: Client, assetId: string, pageNo: number) {
  return supabase.from("store_asset_pages").select("*").eq("asset_id", assetId).eq("page_no", pageNo).maybeSingle();
}

export async function upsertPages(supabase: Client, rows: Array<{ asset_id: string; page_no: number; path: string; width: number; height: number; is_preview: boolean }>) {
  return supabase.from("store_asset_pages").upsert(rows, { onConflict: "asset_id,page_no" });
}

export async function setPreviewPages(supabase: Client, assetId: string, pages: number[]) {
  const reset = await supabase.from("store_asset_pages").update({ is_preview: false }).eq("asset_id", assetId);
  if (reset.error || pages.length === 0) return reset;
  return supabase.from("store_asset_pages").update({ is_preview: true }).eq("asset_id", assetId).in("page_no", pages);
}

// ────────────────────────────────────────────────────────────
// Orders
// ────────────────────────────────────────────────────────────

export async function createOrder(
  supabase: Client,
  order: Omit<StoreOrder, "id" | "status" | "provider_payment_id" | "eft_proof_path" | "paid_at" | "created_at">,
  items: Array<Omit<StoreOrderItem, "id" | "order_id">>
) {
  const { data, error } = await supabase.from("store_orders").insert({ ...order, status: "pending" }).select("*").single();
  if (error || !data) return { data: null, error: error ?? { message: "Order not created" } };
  const rows = items.map((i) => ({ ...i, order_id: data.id }));
  const res = await supabase.from("store_order_items").insert(rows).select("*");
  if (res.error) {
    await supabase.from("store_orders").delete().eq("id", data.id);
    return { data: null, error: res.error };
  }
  return { data: { order: data as StoreOrder, items: res.data as StoreOrderItem[] }, error: null };
}

/** Pin the Stripe Checkout session to a pending Stripe order (set once). */
export async function setStripeSession(supabase: Client, orderId: string, sessionId: string) {
  return supabase
    .from("store_orders")
    .update({ provider_payment_id: sessionId })
    .eq("id", orderId)
    .eq("payment_method", "stripe")
    .eq("status", "pending")
    .is("provider_payment_id", null)
    .select("id")
    .maybeSingle();
}

/** Record a Stripe webhook event once. A unique-violation (23505) means we've seen it. */
export async function claimStripeEvent(
  supabase: Client,
  e: { id: string; type: string; sessionId: string; orderId: string }
): Promise<"new" | "duplicate" | "error"> {
  const { error } = await supabase
    .from("store_stripe_events")
    .insert({ event_id: e.id, event_type: e.type, session_id: e.sessionId, order_id: e.orderId });
  if (!error) return "new";
  return error.code === "23505" ? "duplicate" : "error";
}

export async function releaseStripeEvent(supabase: Client, id: string) {
  return supabase.from("store_stripe_events").delete().eq("event_id", id);
}

export async function getOrder(supabase: Client, id: string) {
  return supabase.from("store_orders").select("*").eq("id", id).maybeSingle();
}

export async function getOrderItems(supabase: Client, orderId: string) {
  return supabase.from("store_order_items").select("*").eq("order_id", orderId);
}

export async function listOrders(supabase: Client, opts: { status?: string; limit?: number } = {}) {
  let q = supabase
    .from("store_orders")
    .select("*, store_order_items(id, title, variant_label, quantity, purpose, unit_price_cents), store_fulfilments(status, method)")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  return q;
}

/** A buyer's orders by user id or email. */
export async function listBuyerOrders(supabase: Client, who: { userId: string; email: string }) {
  return supabase
    .from("store_orders")
    .select("*, store_order_items(*), store_fulfilments(status, method, tracking, updated_at)")
    .or(`buyer_user_id.eq.${who.userId},buyer_email.eq.${who.email.toLowerCase()}`)
    .order("created_at", { ascending: false });
}

/** Paid orders for an email (Resend my purchases). Service role. */
export async function listPaidOrdersByEmail(supabase: Client, email: string) {
  return supabase
    .from("store_orders")
    .select("id, reference, paid_at, total_cents, store_order_items(title, variant_label, quantity, purpose)")
    .eq("buyer_email", email.toLowerCase())
    .eq("status", "paid")
    .order("paid_at", { ascending: false });
}

export async function cancelPendingOrder(supabase: Client, id: string) {
  return supabase
    .from("store_orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
}

// ────────────────────────────────────────────────────────────
// Entitlements, codes, devices
// ────────────────────────────────────────────────────────────

export async function listEntitlementsFor(supabase: Client, who: { userId: string | null; email: string }) {
  let q = supabase.from("store_entitlements").select("*").is("revoked_at", null);
  q = who.userId ? q.or(`user_id.eq.${who.userId},email.eq.${who.email.toLowerCase()}`) : q.eq("email", who.email.toLowerCase());
  return q;
}

export async function getCode(supabase: Client, code: string) {
  return supabase.from("store_codes").select("*").eq("code", code).maybeSingle();
}

export async function listCodesForItems(supabase: Client, itemIds: string[]) {
  return supabase.from("store_codes").select("*").in("order_item_id", itemIds).order("created_at");
}

/**
 * Redeem a code for one email: claim it (only if unredeemed) then grant.
 * The claim is a conditional update, so two people racing for one code
 * can't both win.
 */
export async function redeemCode(
  supabase: Client,
  input: { codeId: string; email: string; userId: string | null; entitlement: { product_id: string; includes_pdf: boolean; starts_at: string; expires_at: string | null }; kind: "gift" | "pack" }
) {
  const claimed = await supabase
    .from("store_codes")
    .update({ redeemed_at: new Date().toISOString(), redeemed_email: input.email })
    .eq("id", input.codeId)
    .is("redeemed_at", null)
    .select("id")
    .maybeSingle();
  if (claimed.error) return { data: null, error: claimed.error };
  if (!claimed.data) return { data: null, error: { message: "already-redeemed" } };
  return supabase
    .from("store_entitlements")
    .insert({
      ...input.entitlement,
      email: input.email,
      user_id: input.userId,
      source: input.kind === "gift" ? "gift" : "code",
      code_id: input.codeId,
    })
    .select("*")
    .single();
}

export async function linkEntitlementsToUser(supabase: Client, email: string, userId: string) {
  return supabase.from("store_entitlements").update({ user_id: userId }).eq("email", email.toLowerCase()).is("user_id", null);
}

export async function linkOrdersToUser(supabase: Client, email: string, userId: string) {
  return supabase.from("store_orders").update({ buyer_user_id: userId }).eq("buyer_email", email.toLowerCase()).is("buyer_user_id", null);
}

export async function registerDevice(supabase: Client, input: { userId: string; deviceHash: string; label: string; limit: number }) {
  return supabase.rpc("store_register_device", {
    p_user_id: input.userId,
    p_device_hash: input.deviceHash,
    p_label: input.label,
    p_limit: input.limit,
  });
}

/**
 * Take one PDF download from the oldest of these entitlements that has one
 * left (store_take_pdf_download, service role only; one UPDATE ... WHERE
 * pdf_downloads_used < limit). data: the entitlement id charged, or null
 * when they're all used up.
 */
export async function takePdfDownload(supabase: Client, entitlementIds: string[], limit: number) {
  const { data, error } = await supabase.rpc("store_take_pdf_download", { p_entitlement_ids: entitlementIds, p_limit: limit });
  return { data: (typeof data === "string" ? data : null) as string | null, error };
}

/** Give back a download taken for a PDF that then couldn't be prepared. */
export async function returnPdfDownload(supabase: Client, entitlementId: string) {
  return supabase.rpc("store_return_pdf_download", { p_entitlement_id: entitlementId });
}

export async function listDevices(supabase: Client, userId: string) {
  return supabase
    .from("store_devices")
    .select("id, user_id, label, created_at, last_seen_at, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("last_seen_at", { ascending: false });
}

/**
 * Remove one of a buyer's devices through store_remove_device (service role
 * only; it only ever sets removed_at). Buyers have no UPDATE on
 * store_devices, so a removed device can't be brought back to lift the cap.
 * data: true when removed, false when it wasn't theirs / already removed.
 */
export async function removeDevice(supabase: Client, userId: string, id: string) {
  const { data, error } = await supabase.rpc("store_remove_device", { p_user_id: userId, p_device_id: id });
  return { data: data === true, error };
}

export async function isDeviceActive(supabase: Client, userId: string, deviceHash: string) {
  const { data, error } = await supabase
    .from("store_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_hash", deviceHash)
    .is("removed_at", null)
    .maybeSingle();
  return { data: !!data, error };
}

// ────────────────────────────────────────────────────────────
// Fulfilment
// ────────────────────────────────────────────────────────────

export async function getFulfilment(supabase: Client, orderId: string) {
  return supabase.from("store_fulfilments").select("*").eq("order_id", orderId).maybeSingle();
}

export async function moveFulfilment(
  supabase: Client,
  orderId: string,
  from: FulfilmentStatus,
  patch: { status: FulfilmentStatus; tracking?: string | null; notes?: string | null; updated_by: string | null }
) {
  return supabase
    .from("store_fulfilments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", from)
    .select("*")
    .maybeSingle();
}

// ────────────────────────────────────────────────────────────
// Settle (service role): pending → paid, then the plan
// ────────────────────────────────────────────────────────────

export type SettleOutcome =
  | { outcome: "settled"; order: StoreOrder; plan: SettlementPlan; stockShort: string[] }
  | { outcome: "already" }
  | { outcome: "error"; error: string };

/**
 * Flip an order to paid and apply what it buys. The status flip is guarded
 * (eq status = pending), so only the first caller applies the plan.
 * `planFor` is passed in so the caller decides with fresh rows.
 */
export async function settleStoreOrder(
  supabase: Client,
  input: {
    orderId: string;
    providerPaymentId?: string | null;
    markedPaidBy?: string | null;
    planFor: (order: StoreOrder, items: StoreOrderItem[], products: StoreProduct[]) => SettlementPlan;
  }
): Promise<SettleOutcome> {
  const { data: order, error } = await supabase
    .from("store_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payment_id: input.providerPaymentId ?? null,
      marked_paid_by: input.markedPaidBy ?? null,
    })
    .eq("id", input.orderId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) return { outcome: "error", error: error.message };
  if (!order) return { outcome: "already" };

  const { data: items, error: itemsErr } = await getOrderItems(supabase, order.id);
  if (itemsErr) return { outcome: "error", error: itemsErr.message };
  const productIds = [...new Set((items ?? []).map((i: StoreOrderItem) => i.product_id))] as string[];
  const { data: products, error: prodErr } = await getProductsByIds(supabase, productIds);
  if (prodErr) return { outcome: "error", error: prodErr.message };

  const plan = input.planFor(order, items ?? [], products ?? []);

  const stockShort: string[] = [];
  for (const s of plan.stock) {
    const { data: ok } = await supabase.rpc("store_take_stock", { p_variant_id: s.variant_id, p_quantity: s.quantity });
    if (ok === false) stockShort.push(s.variant_id);
  }
  if (plan.entitlements.length) {
    const r = await supabase.from("store_entitlements").insert(plan.entitlements);
    if (r.error) return { outcome: "error", error: r.error.message };
  }
  if (plan.codes.length) {
    const r = await supabase.from("store_codes").insert(plan.codes);
    if (r.error) return { outcome: "error", error: r.error.message };
  }
  if (plan.fulfilment) {
    const r = await supabase.from("store_fulfilments").insert({ order_id: order.id, ...plan.fulfilment });
    if (r.error) return { outcome: "error", error: r.error.message };
  }
  return { outcome: "settled", order, plan, stockShort };
}
