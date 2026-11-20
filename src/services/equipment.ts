// Equipment hire + asset register — data access. The equipment_* tables
// (migration 255) aren't in the generated database.ts yet, so this service
// uses the project's standard `Client = any` pattern and hand-written row
// types (mirrors services/vehicles.ts). Spec: handoff/19-equipment-hire.md.
//
//   PRODUCTS are what customers see (price, photos, listing).
//   UNITS are physical things with a tag (AUD-0014), serial, status.
//   ORDERS book a QUANTITY of a product; units are attached by scanning.

import { getRoleDerivedPermissionRows } from "@/services/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ── Types ──────────────────────────────────────────────────

/** What a person decides. "reserved" and "out" are never stored. */
export type EquipmentUnitStatus = "available" | "maintenance" | "retired";

/** equipment_unit_state.live_status — stored status plus what orders say. */
export type EquipmentLiveStatus = EquipmentUnitStatus | "reserved" | "out";

export type EquipmentOrderStatus =
  | "quote"
  | "awaiting_payment"
  | "requested"
  | "confirmed"
  | "prepping"
  | "out"
  | "returned"
  | "inspected"
  | "closed"
  | "declined"
  | "cancelled";

export type EquipmentLocation = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
};

export type EquipmentCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  blurb: string | null;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
};

export type EquipmentProduct = {
  id: string;
  seed_key: string | null;
  name: string;
  brand: string | null;
  model: string | null;
  slug: string;
  /** audio / visual / auxiliary / … free text on purpose. */
  register_category: string;
  store_category_id: string | null;
  owner_ministry_id: string | null;
  description: string | null;
  included: string[];
  specs: Record<string, string>;
  can_leave_building: boolean;
  is_listed: boolean;
  listed_at: string | null;
  price_day_cents: number | null;
  price_weekend_cents: number | null;
  price_week_cents: number | null;
  deposit_cents: number;
  internal_day_cents: number;
  max_per_order: number | null;
  sort_order: number;
  is_kit: boolean;
  /** Per-unit value from the first (Sortly) inventory, cents. INTERNAL: never on the store (285/287). */
  replacement_value_cents?: number | null;
  /** Sortly item id. INTERNAL. */
  sortly_sid?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentProductPhoto = {
  id: string;
  product_id: string;
  file_path: string;
  alt: string | null;
  sort_order: number;
  created_at: string;
};

export type EquipmentKitPart = {
  kit_id: string;
  part_id: string;
  quantity: number;
};

export type EquipmentRelated = {
  product_id: string;
  related_id: string;
  sort_order: number;
};

export type EquipmentUnit = {
  id: string;
  product_id: string;
  tag: string;
  label: string | null;
  serial: string | null;
  status: EquipmentUnitStatus;
  condition: string | null;
  condition_note: string | null;
  location_id: string | null;
  owner_ministry_id: string | null;
  supplier: string | null;
  purchase_date: string | null;
  purchase_price_cents: number | null;
  warranty_until: string | null;
  last_checked_on: string | null;
  tag_printed_at: string | null;
  source: EquipmentUnitSource | null;
  /** The sheet's "Assigned to", verbatim (285). Not in equipment_unit_state: read from equipment_units. */
  owner_label?: string | null;
  created_at: string;
  updated_at: string;
};

/** equipment_units.source: where an imported row came from. INTERNAL. */
export type EquipmentUnitSource = {
  sheet?: string;
  tab?: string;
  row?: number;
  sheet_quantity_header?: number | null;
  origin?: string;
  unverified?: boolean;
  sortly_row?: number;
  sid?: string;
};

/** A row of the equipment_unit_state view. */
export type EquipmentUnitState = EquipmentUnit & {
  live_status: EquipmentLiveStatus;
  current_order_id: string | null;
};

export type EquipmentOrder = {
  id: string;
  number: string;
  kind: "external" | "internal";
  status: EquipmentOrderStatus;
  customer_user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_org: string | null;
  ministry_id: string | null;
  starts_on: string;
  ends_on: string;
  collect_time: string | null;
  return_time: string | null;
  rate_period: "day" | "weekend" | "week";
  fulfilment: "collect" | "delivery";
  delivery_address: string | null;
  subtotal_cents: number;
  waiver_cents: number;
  vat_cents: number;
  total_cents: number;
  deposit_cents: number;
  id_verified_at: string | null;
  agreement_version: string | null;
  agreement_accepted_at: string | null;
  agreement_signed_name: string | null;
  approved_by: string | null;
  approved_at: string | null;
  decline_reason: string | null;
  access_token: string;
  /** Unpaid orders hold stock only until this time (migration 380). */
  hold_expires_at: string | null;
  customer_id_number: string | null;
  /** What it's for, e.g. "Missio youth night". */
  purpose: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentOrderLine = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  deposit_cents: number;
  line_total_cents: number;
  created_at: string;
};

export type EquipmentOrderUnit = {
  id: string;
  order_id: string;
  line_id: string;
  unit_id: string;
  packed_at: string;
  packed_by: string | null;
  handed_over_at: string | null;
  returned_at: string | null;
  checked_in_by: string | null;
  return_condition: "fine" | "damaged" | "missing" | null;
  return_note: string | null;
};

export type EquipmentEvent = {
  id: string;
  unit_id: string | null;
  order_id: string | null;
  /** imported, packed, out, returned, damaged, missing, repair_opened, repair_closed, moved, edited, retired */
  kind: string;
  detail: string | null;
  actor_id: string | null;
  at: string;
};

export type EquipmentMaintenance = {
  id: string;
  unit_id: string;
  status: "reported" | "at_repairer" | "done" | "written_off";
  reason: string;
  source_order_id: string | null;
  repairer: string | null;
  cost_cents: number | null;
  due_back_on: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
};

export type EquipmentDeduction = {
  id: string;
  order_id: string;
  unit_id: string | null;
  kind: "damage" | "missing" | "late";
  amount_cents: number;
  note: string | null;
  status: "proposed" | "confirmed" | "waived";
  proposed_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type EquipmentFile = {
  id: string;
  order_id: string | null;
  unit_id: string | null;
  moment: "handover" | "return" | "repair" | "unit";
  kind: "photo" | "signature" | "document";
  file_path: string;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export type EquipmentPayment = {
  id: string;
  order_id: string;
  kind: "hire" | "deposit" | "deposit_refund" | "deduction";
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "cancelled" | "failed" | "refunded";
  payment_provider: string;
  provider_reference: string | null;
  provider_payment_id: string | null;
  xero_item_code: string | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentSettings = {
  id: true;
  vat_bps: number;
  waiver_bps: number;
  waiver_cover_cents: number;
  late_fee_rule: string;
  deposit_refund_days: number;
  agreement_version: string;
  xero_item_code: string | null;
  updated_at: string;
};

export type EquipmentAccess = {
  isAdmin: boolean;
  /** has_equipment_access(): any equipment permission at all. */
  canView: boolean;
  canRequest: boolean;
  canOperate: boolean;
  canManage: boolean;
};

/** A product with the refs the register shows. */
export type EquipmentProductWithRefs = EquipmentProduct & {
  owner?: { id: string; name: string } | null;
  store_category?: Pick<EquipmentCategory, "id" | "name" | "slug"> | null;
};

const PRODUCT_EMBED =
  "owner:ministries!equipment_products_owner_ministry_id_fkey(id,name),store_category:equipment_categories(id,name,slug)";

/**
 * The product columns the public store reads, named one by one. Never `*`:
 * replacement_value_cents and sortly_sid are internal, and after migration
 * 287 anon may only select the columns granted there (a superset of these).
 */
export const STORE_PRODUCT_COLUMNS = [
  "id",
  "slug",
  "name",
  "brand",
  "model",
  "register_category",
  "store_category_id",
  "description",
  "included",
  "specs",
  "can_leave_building",
  "is_listed",
  "listed_at",
  "price_day_cents",
  "price_weekend_cents",
  "price_week_cents",
  "deposit_cents",
  "internal_day_cents",
  "max_per_order",
  "sort_order",
  "is_kit",
  "created_at",
  "updated_at",
] as const;

/** Columns that must never reach the public site. */
export const INTERNAL_PRODUCT_COLUMNS = ["replacement_value_cents", "sortly_sid"] as const;
export const INTERNAL_UNIT_COLUMNS = ["owner_label", "source"] as const;

const STORE_PRODUCT_SELECT = `${STORE_PRODUCT_COLUMNS.join(",")},store_category:equipment_categories(id,name,slug)`;

// ── Access ─────────────────────────────────────────────────

/** The SQL gate itself (has_equipment_access), so pages agree with RLS. */
export async function hasEquipmentAccess(supabase: Client): Promise<boolean> {
  const { data } = await supabase.rpc("has_equipment_access");
  return data === true;
}

export async function getEquipmentAccess(
  supabase: Client,
  userId: string
): Promise<EquipmentAccess> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if ((roleRows?.length ?? 0) > 0) {
    return {
      isAdmin: true,
      canView: true,
      canRequest: true,
      canOperate: true,
      canManage: true,
    };
  }

  const { data: permRows } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key,module)")
    .eq("user_id", userId)
    .eq("permissions.module", "equipment");

  const keys = new Set<string>();
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    if (perm?.key) keys.add(perm.key);
  }

  // Role bundles too, so UI gating matches the role-aware has_permission
  // that has_equipment_access() and the RLS policies use.
  for (const perm of await getRoleDerivedPermissionRows(supabase, userId)) {
    if (perm.module === "equipment") keys.add(perm.key);
  }

  const canManage = keys.has("equipment.manage");
  return {
    isAdmin: false,
    canView: keys.size > 0,
    canRequest: keys.has("equipment.request"),
    canOperate: canManage || keys.has("equipment.operate"),
    canManage,
  };
}

// ── Products ───────────────────────────────────────────────

/**
 * Products. `listedOnly` is the storefront's call, so it selects the named
 * store columns only; the register (staff) gets everything.
 */
export async function listProducts(
  supabase: Client,
  opts?: { listedOnly?: boolean; registerCategory?: string }
) {
  let query = supabase
    .from("equipment_products")
    .select(opts?.listedOnly ? STORE_PRODUCT_SELECT : `*,${PRODUCT_EMBED}`)
    .order("register_category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.listedOnly) query = query.eq("is_listed", true);
  if (opts?.registerCategory) query = query.eq("register_category", opts.registerCategory);
  return query;
}

/** The public item page (/hire/p/[slug]): store columns only. */
export async function getProductBySlug(supabase: Client, slug: string) {
  return supabase
    .from("equipment_products")
    .select(STORE_PRODUCT_SELECT)
    .eq("slug", slug)
    .maybeSingle();
}

export async function getProductById(supabase: Client, id: string) {
  return supabase
    .from("equipment_products")
    .select(`*,${PRODUCT_EMBED}`)
    .eq("id", id)
    .maybeSingle();
}

// ── Units ──────────────────────────────────────────────────

/**
 * Units with their live status (equipment_unit_state), ordered by tag.
 * Plain columns only: PostgREST embeds through a view are unreliable, so
 * callers join locations and ministries from listLocations / listMinistries.
 */
export async function listUnits(
  supabase: Client,
  opts?: { productId?: string; includeRetired?: boolean }
) {
  let query = supabase
    .from("equipment_unit_state")
    .select("*")
    .order("tag", { ascending: true });
  if (opts?.productId) query = query.eq("product_id", opts.productId);
  if (!opts?.includeRetired) query = query.neq("status", "retired");
  return query;
}

export async function getUnitByTag(supabase: Client, tag: string) {
  return supabase
    .from("equipment_unit_state")
    .select("*")
    .eq("tag", tag.toUpperCase())
    .maybeSingle();
}

/**
 * owner_label for units (285). Read from equipment_units because the
 * equipment_unit_state view was frozen at `u.*` before the column existed.
 * Pass ids to narrow it; callers treat an error (285 not applied yet) as "none".
 */
export async function listUnitOwnerLabels(supabase: Client, unitIds?: string[]) {
  let query = supabase.from("equipment_units").select("id,owner_label");
  if (unitIds) query = query.in("id", unitIds);
  return query;
}

/** One unit's editable row, straight from equipment_units (staff only, RLS). */
export async function getUnitRowByTag(supabase: Client, tag: string) {
  return supabase.from("equipment_units").select("*").eq("tag", tag.toUpperCase()).maybeSingle();
}

export async function updateUnit(supabase: Client, id: string, data: Partial<EquipmentUnit>) {
  return supabase
    .from("equipment_units")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function insertUnitEvent(
  supabase: Client,
  data: Pick<EquipmentEvent, "unit_id" | "kind" | "detail" | "actor_id">
) {
  return supabase.from("equipment_events").insert(data).select().single();
}

export async function listLocations(supabase: Client) {
  return supabase
    .from("equipment_locations")
    .select("id,name,slug,parent_id")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

export async function listMinistries(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [] as { id: string; name: string }[], error: null };
  return supabase.from("ministries").select("id,name").in("id", ids);
}

/** Units of a product that still exist (not retired). */
export async function countProductUnits(supabase: Client, productId: string) {
  return supabase
    .from("equipment_units")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId)
    .neq("status", "retired");
}

/** A unit's history, newest first. */
export async function listUnitEvents(supabase: Client, unitId: string) {
  return supabase
    .from("equipment_events")
    .select("*")
    .eq("unit_id", unitId)
    .order("at", { ascending: false });
}

/** Repairs still open on a unit (reported or at the repairer). */
export async function listOpenMaintenance(supabase: Client, unitId: string) {
  return supabase
    .from("equipment_maintenance")
    .select("*")
    .eq("unit_id", unitId)
    .in("status", ["reported", "at_repairer"])
    .order("opened_at", { ascending: false });
}

/** Orders a unit has been scanned onto, newest first. */
export async function listUnitOrders(supabase: Client, unitId: string) {
  return supabase
    .from("equipment_order_units")
    .select(
      "*,order:equipment_orders(id,number,status,customer_name,starts_on,ends_on)"
    )
    .eq("unit_id", unitId)
    .order("packed_at", { ascending: false });
}

// ── Availability ───────────────────────────────────────────
// By calendar day, inclusive, worst day wins (spec rule 3). The counting is
// done in SQL so the storefront, cart and checkout all agree.

/** Free units of a product on the worst day of [from, to]. */
export async function freeCount(
  supabase: Client,
  productId: string,
  from: string,
  to: string,
  ignoreOrderId?: string
): Promise<{ data: number | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("equipment_free_count", {
    p_product: productId,
    p_from: from,
    p_to: to,
    p_ignore_order: ignoreOrderId ?? null,
  });
  return { data: typeof data === "number" ? data : null, error };
}

/** Free units per day, for the item-page month calendar. */
export async function freeByDay(
  supabase: Client,
  productId: string,
  from: string,
  to: string
): Promise<{ data: { day: string; free: number }[] | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("equipment_free_by_day", {
    p_product: productId,
    p_from: from,
    p_to: to,
  });
  return { data: (data as { day: string; free: number }[] | null) ?? null, error };
}

export type KitAvailability = {
  /** How many whole kits are free on the worst day. */
  free: number;
  /** The part that sets the limit, so the cart can say which one ran out. */
  limitingPart: { productId: string; name: string; free: number; perKit: number } | null;
};

/**
 * A kit is free as many times as its scarcest part allows:
 * min over parts of floor(part free / part quantity).
 */
export async function freeCountForKit(
  supabase: Client,
  kitId: string,
  from: string,
  to: string,
  ignoreOrderId?: string
): Promise<{ data: KitAvailability | null; error: { message: string } | null }> {
  const { data: parts, error } = await supabase
    .from("equipment_kit_parts")
    .select("part_id,quantity,part:equipment_products!equipment_kit_parts_part_id_fkey(id,name)")
    .eq("kit_id", kitId);
  if (error) return { data: null, error };
  if (!parts || parts.length === 0) return { data: { free: 0, limitingPart: null }, error: null };

  const counts = await Promise.all(
    parts.map((p: { part_id: string }) => freeCount(supabase, p.part_id, from, to, ignoreOrderId))
  );
  const failed = counts.find((c) => c.error);
  if (failed) return { data: null, error: failed.error };

  let result: KitAvailability = { free: Number.POSITIVE_INFINITY, limitingPart: null };
  parts.forEach(
    (p: { part_id: string; quantity: number; part: { name: string } | { name: string }[] | null }, i: number) => {
      const partFree = counts[i].data ?? 0;
      const kits = Math.floor(partFree / p.quantity);
      if (kits < result.free) {
        const part = Array.isArray(p.part) ? p.part[0] : p.part;
        result = {
          free: kits,
          limitingPart: { productId: p.part_id, name: part?.name ?? "A part", free: partFree, perKit: p.quantity },
        };
      }
    }
  );
  return { data: result, error: null };
}

// ── Settings ───────────────────────────────────────────────

export async function getEquipmentSettings(supabase: Client) {
  return supabase.from("equipment_settings").select("*").eq("id", true).maybeSingle();
}

export async function updateEquipmentSettings(supabase: Client, data: Partial<EquipmentSettings>) {
  return supabase
    .from("equipment_settings")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select()
    .single();
}

// ── Listing (stage L) ──────────────────────────────────────

export async function updateProduct(supabase: Client, id: string, data: Partial<EquipmentProduct>) {
  return supabase
    .from("equipment_products")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function listCategories(supabase: Client, opts?: { visibleOnly?: boolean }) {
  let query = supabase
    .from("equipment_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.visibleOnly) query = query.eq("is_visible", true);
  return query;
}

export async function getCategoryBySlug(supabase: Client, slug: string) {
  return supabase.from("equipment_categories").select("*").eq("slug", slug).maybeSingle();
}

export async function listProductPhotos(supabase: Client, productIds: string[]) {
  if (productIds.length === 0) return { data: [] as EquipmentProductPhoto[], error: null };
  return supabase
    .from("equipment_product_photos")
    .select("*")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

export async function insertProductPhoto(
  supabase: Client,
  data: Pick<EquipmentProductPhoto, "product_id" | "file_path" | "alt" | "sort_order">
) {
  return supabase.from("equipment_product_photos").insert(data).select().single();
}

export async function deleteProductPhoto(supabase: Client, id: string) {
  return supabase.from("equipment_product_photos").delete().eq("id", id).select().maybeSingle();
}

/** Free count and stock for every listed product over [from, to] (migration 257). */
export async function listedAvailability(
  supabase: Client,
  from: string,
  to: string
): Promise<{ data: Map<string, { stock: number; free: number }>; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("equipment_listed_availability", { p_from: from, p_to: to });
  const map = new Map<string, { stock: number; free: number }>();
  for (const r of (data ?? []) as { product_id: string; stock: number; free: number }[]) {
    map.set(r.product_id, { stock: r.stock, free: r.free });
  }
  return { data: map, error };
}

/** First day on or after `from` with `qty` free, or null inside ~6 months. */
export async function freeFrom(supabase: Client, productId: string, from: string, qty = 1) {
  const { data, error } = await supabase.rpc("equipment_free_from", {
    p_product: productId,
    p_from: from,
    p_qty: qty,
  });
  return { data: (data as string | null) ?? null, error };
}

/** "Frequently rented with": the hand-picked related product ids. */
export async function listRelatedIds(supabase: Client, productId: string) {
  return supabase
    .from("equipment_related")
    .select("related_id")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
}

/**
 * For /t/[tag]: the product a tag belongs to. Call with the service-role
 * client (the public can't read units) and pass on nothing but the slug.
 */
export async function getTagProduct(
  supabase: Client,
  tag: string
): Promise<{ slug: string; is_listed: boolean } | null> {
  const { data } = await supabase
    .from("equipment_units")
    .select("product:equipment_products(slug,is_listed)")
    .eq("tag", tag)
    .maybeSingle();
  const p = Array.isArray(data?.product) ? data.product[0] : data?.product;
  return p ?? null;
}

// ── Orders (stage M) ───────────────────────────────────────

export type EquipmentOrderFull = EquipmentOrder & {
  lines: (EquipmentOrderLine & {
    product: Pick<EquipmentProduct, "id" | "name" | "brand" | "model" | "slug" | "price_day_cents"> | null;
  })[];
  payments: EquipmentPayment[];
  units: (EquipmentOrderUnit & { unit: Pick<EquipmentUnit, "id" | "tag" | "product_id"> | null })[];
  ministry: { id: string; name: string } | null;
};

const ORDER_EMBED =
  "*,lines:equipment_order_lines(*,product:equipment_products(id,name,brand,model,slug,price_day_cents))," +
  "payments:equipment_payments(*),units:equipment_order_units(*,unit:equipment_units(id,tag,product_id))," +
  "ministry:ministries(id,name)";

export async function getOrderById(supabase: Client, id: string) {
  return supabase.from("equipment_orders").select(ORDER_EMBED).eq("id", id).maybeSingle();
}

/** For /hire/o/[token] — call with the service-role client; the token is the key. */
export async function getOrderByToken(admin: Client, token: string) {
  return admin.from("equipment_orders").select(ORDER_EMBED).eq("access_token", token).maybeSingle();
}

export async function listOrders(supabase: Client, opts?: { statuses?: string[]; limit?: number }) {
  let query = supabase
    .from("equipment_orders")
    .select(
      "id,number,kind,status,customer_name,customer_org,starts_on,ends_on,total_cents,deposit_cents,purpose,created_at,hold_expires_at,ministry:ministries(id,name),lines:equipment_order_lines(quantity)"
    )
    .order("starts_on", { ascending: true })
    .limit(opts?.limit ?? 200);
  if (opts?.statuses?.length) query = query.in("status", opts.statuses);
  return query;
}

export async function updateOrder(supabase: Client, id: string, data: Partial<EquipmentOrder>) {
  return supabase
    .from("equipment_orders")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

/** Move an order on only if it's still in the status we expect (replays are no-ops). */
export async function moveOrderIfStatus(
  supabase: Client,
  id: string,
  from: EquipmentOrderStatus[],
  data: Partial<EquipmentOrder>
) {
  return supabase
    .from("equipment_orders")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from)
    .select()
    .maybeSingle();
}

/** pending → paid for every pending payment on an order; returns the rows it flipped. */
export async function markOrderPaymentsPaid(admin: Client, orderId: string, providerPaymentId: string | null) {
  const now = new Date().toISOString();
  return admin
    .from("equipment_payments")
    .update({ status: "paid", paid_at: now, provider_payment_id: providerPaymentId, updated_at: now })
    .eq("order_id", orderId)
    .eq("status", "pending")
    .in("kind", ["hire", "deposit"])
    .select();
}

export async function markOrderPaymentsStatus(admin: Client, orderId: string, status: "cancelled" | "failed") {
  return admin
    .from("equipment_payments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("status", "pending")
    .select();
}

export async function updatePayment(admin: Client, id: string, data: Partial<EquipmentPayment>) {
  return admin
    .from("equipment_payments")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function insertEquipmentEvent(
  admin: Client,
  data: Pick<EquipmentEvent, "kind"> & Partial<Pick<EquipmentEvent, "unit_id" | "order_id" | "detail" | "actor_id">>
) {
  return admin.from("equipment_events").insert(data);
}

export async function listOrderEvents(supabase: Client, orderId: string) {
  return supabase
    .from("equipment_events")
    .select("*")
    .eq("order_id", orderId)
    .is("unit_id", null)
    .order("at", { ascending: false });
}

export async function listActiveMinistries(supabase: Client) {
  return supabase.from("ministries").select("id,name").eq("is_active", true).order("sort_order").order("name");
}

/**
 * Everyone who should hear about a ministry request or a problem: holders of
 * equipment.manage (direct or via a role). Nobody else — an earlier fallback
 * to every super admin sent a test request to five people. If nobody holds
 * it, this returns [] and the caller logs it; the request still shows on
 * the Orders page. Admin client.
 */
export async function getEquipmentManagerEmails(admin: Client): Promise<string[]> {
  const userIds = new Set<string>();
  const { data: perms } = await admin.from("permissions").select("id").eq("key", "equipment.manage");
  const permIds = (perms ?? []).map((p: { id: string }) => p.id);
  if (permIds.length) {
    const { data: direct } = await admin.from("user_permissions").select("user_id").in("permission_id", permIds);
    for (const r of direct ?? []) userIds.add(r.user_id as string);
    const { data: rolePerms } = await admin.from("role_permissions").select("role_id").in("permission_id", permIds);
    const roleIds = [...new Set((rolePerms ?? []).map((r: { role_id: string }) => r.role_id))];
    if (roleIds.length) {
      const { data: holders } = await admin.from("user_roles").select("user_id").in("role_id", roleIds);
      for (const r of holders ?? []) userIds.add(r.user_id as string);
    }
  }
  if (userIds.size === 0) return [];
  const { data: users } = await admin.from("users").select("email").in("id", [...userIds]).eq("is_active", true);
  return [...new Set((users ?? []).map((u: { email: string | null }) => u.email?.trim()).filter(Boolean) as string[])];
}

/**
 * equipment_place_order (migration 380): lock, re-check and insert the whole
 * order in one transaction. Service-role client only.
 */
export async function placeOrder(
  admin: Client,
  order: Record<string, unknown>,
  lines: Record<string, unknown>[],
  payments: Record<string, unknown>[]
): Promise<{ data: { id: string; number: string; access_token: string } | null; error: { message: string } | null }> {
  const { data, error } = await admin.rpc("equipment_place_order", {
    p_order: order,
    p_lines: lines,
    p_payments: payments,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row ?? null, error };
}

export async function getProductsByIds(supabase: Client, ids: string[]) {
  if (ids.length === 0) return { data: [] as EquipmentProduct[], error: null };
  return supabase.from("equipment_products").select("*").in("id", ids);
}

/** A signed-in customer's own orders (RLS: customer_user_id = auth.uid()). */
export async function listMyOrders(supabase: Client, userId: string) {
  return supabase
    .from("equipment_orders")
    .select("id,number,kind,status,starts_on,ends_on,purpose,access_token,total_cents")
    .eq("customer_user_id", userId)
    .neq("status", "quote")
    .order("starts_on", { ascending: false })
    .limit(50);
}
