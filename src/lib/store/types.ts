// ============================================================
// Store — hand-written row types for migration 412
// ============================================================
// src/types/database.ts is generated from the live schema and 412 isn't
// applied yet, so the Store carries its own narrow types. Delete these in
// favour of the generated ones once 412 is applied and types regenerated.
// ============================================================

export type ProductKind = "digital" | "subscription" | "physical" | "bundle";
export type ProductStatus = "draft" | "published" | "archived";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";
export type PaymentMethod = "payfast" | "eft";
export type FulfilmentMethod = "none" | "delivery" | "collect";
export type ItemPurpose = "self" | "gift" | "code_pack";
export type FulfilmentStatus = "preorder" | "to_pack" | "ready_to_collect" | "shipped" | "collected" | "delivered";

export type StoreProduct = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  kind: ProductKind;
  status: ProductStatus;
  price_cents: number;
  currency: "ZAR";
  cover_image_url: string | null;
  /** Optional flipbook music in the private store-audio bucket. Read only where needed (getProductAudio). */
  audio_path?: string | null;
  subscription_months: number | null;
  ships: boolean;
  allow_delivery: boolean;
  allow_collect: boolean;
  delivery_fee_cents: number;
  is_preorder: boolean;
  preorder_ships_on: string | null;
  allow_gift: boolean;
  allow_code_packs: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type StoreVariant = {
  id: string;
  product_id: string;
  label: string;
  sku: string | null;
  price_cents: number | null;
  stock: number | null;
  active: boolean;
  sort_order: number;
};

export type StoreAsset = {
  id: string;
  product_id: string;
  source_path: string;
  filename: string | null;
  byte_size: number | null;
  page_count: number;
  status: "awaiting_upload" | "uploaded" | "rendering" | "ready" | "failed";
  error: string | null;
  render_started_at: string | null;
  is_active: boolean;
  created_at: string;
  ready_at: string | null;
};

export type StoreAssetPage = {
  asset_id: string;
  page_no: number;
  path: string;
  width: number;
  height: number;
  is_preview: boolean;
};

export type DeliveryAddress = {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postal_code: string;
};

export type StoreOrder = {
  id: string;
  reference: string;
  buyer_email: string;
  buyer_name: string;
  buyer_phone: string | null;
  buyer_user_id: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  subtotal_cents: number;
  delivery_cents: number;
  total_cents: number;
  fulfilment_method: FulfilmentMethod;
  delivery_address: DeliveryAddress | null;
  provider_payment_id: string | null;
  eft_proof_path: string | null;
  paid_at: string | null;
  created_at: string;
};

export type StoreOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  title: string;
  variant_label: string | null;
  quantity: number;
  unit_price_cents: number;
  purpose: ItemPurpose;
  gift_recipient_email: string | null;
  gift_message: string | null;
};

export type StoreEntitlement = {
  id: string;
  product_id: string;
  email: string;
  user_id: string | null;
  source: "purchase" | "gift" | "code" | "staff";
  order_item_id: string | null;
  code_id: string | null;
  includes_pdf: boolean;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export type StoreCode = {
  id: string;
  code: string;
  kind: "gift" | "pack";
  product_id: string;
  order_item_id: string;
  recipient_email: string | null;
  includes_pdf: boolean;
  redeemed_at: string | null;
  redeemed_email: string | null;
};

export type StoreDevice = {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
  removed_at: string | null;
};

export type StoreFulfilment = {
  id: string;
  order_id: string;
  method: "delivery" | "collect";
  status: FulfilmentStatus;
  tracking: string | null;
  notes: string | null;
  updated_at: string;
};
