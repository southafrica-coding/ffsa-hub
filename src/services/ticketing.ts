// Data access for the Event Ticketing module.
// Pure query construction — business logic (payments, fulfilment,
// CRM resolution) lives in route handlers and dedicated lib
// modules under src/lib/payments/. Follows src/services/school-fees.ts
// style. See FFSA_Hub_Events_Ticketing_Spec.md.

import { DEFAULT_EVENT_CURRENCY } from "@/lib/currencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// FEE PROFILES
// ────────────────────────────────────────────────────────────

// Rates are per (provider, currency) since migration 134 — pass the
// event's currency so a ZAR fixed fee never prices a USD ticket.
export async function getActiveFeeProfiles(
  supabase: Client,
  currency: string = DEFAULT_EVENT_CURRENCY
) {
  return supabase
    .from("payment_fee_profiles")
    .select("provider, percent_bps, fixed_cents")
    .eq("is_active", true)
    .eq("currency", currency);
}

// ────────────────────────────────────────────────────────────
// TICKET TYPES
// ────────────────────────────────────────────────────────────

export async function listTicketTypesByEvent(
  supabase: Client,
  eventId: string,
  options?: { onlyActive?: boolean }
) {
  let query = supabase
    .from("ticket_types")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (options?.onlyActive) {
    query = query.eq("is_active", true);
  }
  return query;
}

export async function getTicketType(supabase: Client, id: string) {
  return supabase.from("ticket_types").select("*").eq("id", id).single();
}

export async function createTicketType(
  supabase: Client,
  data: {
    event_id: string;
    name: string;
    description?: string | null;
    pricing_mode?: "fixed" | "pwyw";
    target_net_cents: number;
    display_price_cents: number;
    capacity?: number | null;
    max_per_order?: number | null;
    sales_start_at?: string | null;
    sales_end_at?: string | null;
    is_active?: boolean;
    sort_order?: number;
    // Per-tier custom questions (migration 137). Flat FormField[].
    questions?: unknown;
    // Per-tier signable waiver config (migration 163). TierWaiver | null.
    waiver?: unknown;
  }
) {
  return supabase.from("ticket_types").insert(data).select().single();
}

export async function updateTicketType(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("ticket_types")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deleteTicketType(supabase: Client, id: string) {
  return supabase.from("ticket_types").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// PROMO CODES
// ────────────────────────────────────────────────────────────

export async function listPromoCodesByEvent(supabase: Client, eventId: string) {
  return supabase
    .from("promo_codes")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
}

export async function getPromoCode(supabase: Client, id: string) {
  return supabase.from("promo_codes").select("*").eq("id", id).single();
}

/**
 * Look up an active promo code for an event by its (case-insensitive) code.
 * Returns null when none matches — the caller decides how to message the buyer.
 * Does NOT increment redemption_count; the atomic redeem happens at checkout.
 */
export async function findActivePromoCode(
  supabase: Client,
  eventId: string,
  code: string
) {
  return supabase
    .from("promo_codes")
    .select("*")
    .eq("event_id", eventId)
    .ilike("code", code.trim())
    .eq("is_active", true)
    .maybeSingle();
}

export async function createPromoCode(
  supabase: Client,
  data: {
    event_id: string;
    code: string;
    kind: "percent" | "fixed_amount" | "comp";
    percent_off?: number | null;
    amount_off_cents?: number | null;
    applies_to_ticket_type_id?: string | null;
    max_redemptions?: number | null;
    valid_from?: string | null;
    valid_until?: string | null;
    is_active?: boolean;
    created_by?: string | null;
  }
) {
  return supabase.from("promo_codes").insert(data).select().single();
}

export async function updatePromoCode(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("promo_codes")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deletePromoCode(supabase: Client, id: string) {
  return supabase.from("promo_codes").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// ORDERS
// ────────────────────────────────────────────────────────────

export async function listOrdersByEvent(
  supabase: Client,
  eventId: string,
  options?: { status?: string; limit?: number; offset?: number }
) {
  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (options?.status) query = query.eq("status", options.status);
  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }
  return query;
}

export async function getOrder(supabase: Client, id: string) {
  return supabase.from("orders").select("*").eq("id", id).single();
}

// Orders for the admin Orders tab, each with its issued tickets and their
// per-ticket answers (migration 137) so the order detail can show what was
// collected for each ticket. Same rows/order as listOrdersByEvent, plus a
// nested tickets array.
export async function listOrdersWithTicketAnswersByEvent(
  supabase: Client,
  eventId: string
) {
  return supabase
    .from("orders")
    .select(
      "*, tickets(id, code, ticket_type_id, custom_answers, waiver_signature, ticket_types(name))"
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
}

export async function getOrderWithTickets(supabase: Client, id: string) {
  return supabase
    .from("orders")
    .select("*, tickets(*), promo_codes(*)")
    .eq("id", id)
    .single();
}

export async function getOrderByProviderReference(
  supabase: Client,
  providerReference: string
) {
  return supabase
    .from("orders")
    .select("*")
    .eq("provider_reference", providerReference)
    .maybeSingle();
}

export async function createOrder(
  supabase: Client,
  data: {
    event_id: string;
    buyer_first_name: string;
    buyer_last_name: string;
    buyer_email: string;
    buyer_phone?: string | null;
    marketing_consent?: boolean;
    payment_provider?: "payfast" | "stripe" | null;
    subtotal_cents: number;
    discount_cents?: number;
    donation_cents?: number;
    total_cents: number;
    promo_code_id?: string | null;
    expires_at?: string | null;
  }
) {
  return supabase.from("orders").insert(data).select().single();
}

export async function updateOrder(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase.from("orders").update(data).eq("id", id).select().single();
}

/**
 * Idempotent: marks a pending order paid. Only flips status from
 * "pending" — re-deliveries of the same webhook leave a paid order
 * untouched (returns null data without error).
 */
export async function markOrderPaid(
  supabase: Client,
  id: string,
  data: {
    provider_payment_id?: string | null;
    provider_reference?: string | null;
  }
) {
  return supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payment_id: data.provider_payment_id ?? null,
      provider_reference: data.provider_reference ?? null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
}

export async function markOrderExpired(supabase: Client, id: string) {
  return supabase
    .from("orders")
    .update({
      status: "expired",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
}

export async function recordOrderRefund(
  supabase: Client,
  id: string,
  data: { refund_cents: number; full: boolean }
) {
  return supabase
    .from("orders")
    .update({
      status: data.full ? "refunded" : "partially_refunded",
      refunded_at: new Date().toISOString(),
      refund_cents: data.refund_cents,
    })
    .eq("id", id)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// TICKETS
// ────────────────────────────────────────────────────────────

export async function createTickets(
  supabase: Client,
  rows: Array<{
    order_id: string;
    event_id: string;
    ticket_type_id: string;
    code: string;
  }>
) {
  return supabase.from("tickets").insert(rows).select();
}

export async function listTicketsByOrder(supabase: Client, orderId: string) {
  return supabase
    .from("tickets")
    .select("*, ticket_types(name)")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
}

/**
 * All tickets for an event, joined with buyer (orders) and tier
 * (ticket_types) info. Powers the admin Check-in tab:
 *   - aggregate counts (sold / checked in / outstanding)
 *   - attendance roster (who's been scanned in, by whom, when)
 *
 * Voids and pending-order tickets are excluded — we only want
 * tickets that are or were valid at the door.
 */
export async function listAttendanceTicketsByEvent(
  supabase: Client,
  eventId: string
) {
  return supabase
    .from("tickets")
    .select(
      "id, status, code, checked_in_at, checked_in_by, checked_in_by_name, created_at, ticket_types(name), orders!inner(id, status, buyer_first_name, buyer_last_name, buyer_email), users:checked_in_by(first_name, last_name)"
    )
    .eq("event_id", eventId)
    .in("status", ["valid", "checked_in"])
    .eq("orders.status", "paid")
    .order("checked_in_at", { ascending: false, nullsFirst: false });
}

/**
 * Look up a ticket by its scannable code for door check-in.
 * Returns null when no ticket matches — the scanner shows "invalid".
 */
export async function getTicketByCode(supabase: Client, code: string) {
  return supabase
    .from("tickets")
    .select(
      "*, ticket_types(name), orders(event_id, buyer_first_name, buyer_last_name, buyer_email)"
    )
    .eq("code", code)
    .maybeSingle();
}

/**
 * Flip a valid ticket to checked_in. The `eq("status", "valid")` is an
 * optimistic guard — a ticket already checked in or voided won't update,
 * and the caller sees null data (no error) and can show the right message.
 */
export async function checkInTicket(
  supabase: Client,
  id: string,
  checkedInBy: string
) {
  return supabase
    .from("tickets")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checked_in_by: checkedInBy,
    })
    .eq("id", id)
    .eq("status", "valid")
    .select()
    .maybeSingle();
}

/** Void every ticket on an order — used when staff refund the order. */
export async function voidTicketsForOrder(supabase: Client, orderId: string) {
  return supabase
    .from("tickets")
    .update({ status: "void" })
    .eq("order_id", orderId);
}

// ────────────────────────────────────────────────────────────
// ATOMIC INVENTORY (Postgres functions — see migration 058)
// ────────────────────────────────────────────────────────────

/**
 * Atomically increment a ticket type's quantity_sold by `qty` if
 * (a) it's active, (b) inside its sales window, and (c) capacity
 * permits. Returns the updated row on success, or null when any
 * guard fails (sold out / outside window / inactive).
 */
export async function reserveTicketInventory(
  supabase: Client,
  ticketTypeId: string,
  qty: number
) {
  return supabase.rpc("reserve_ticket_inventory", {
    p_ticket_type_id: ticketTypeId,
    p_qty: qty,
  });
}

/**
 * Atomically decrement quantity_sold (clamped to 0). Used when a
 * pending checkout expires or a paid order is refunded.
 */
export async function releaseTicketInventory(
  supabase: Client,
  ticketTypeId: string,
  qty: number
) {
  return supabase.rpc("release_ticket_inventory", {
    p_ticket_type_id: ticketTypeId,
    p_qty: qty,
  });
}

/**
 * Atomically increment a promo code's redemption_count if it's
 * still active, inside its validity window, and hasn't hit its
 * max_redemptions. Returns the updated row, or null on rejection.
 */
export async function redeemPromoCode(supabase: Client, promoCodeId: string) {
  return supabase.rpc("redeem_promo_code", {
    p_promo_code_id: promoCodeId,
  });
}

/**
 * Latest ticket-confirmation email delivery status per order (migration
 * 141). Powers the delivery badge in the Orders tab so staff can see, at
 * a glance, whether a buyer's confirmation actually reached them —
 * instead of learning it failed only when they complain.
 *
 * Returns every ticket_confirmation ledger row for the given orders
 * (newest first); the caller keeps the latest per order. Gracefully
 * returns empty if the migration hasn't been applied yet, mirroring
 * listRefundsForOrders — so the Orders tab never hard-fails on a
 * not-yet-migrated database.
 */
export async function listTicketEmailsForOrders(
  supabase: Client,
  orderIds: string[]
) {
  if (orderIds.length === 0) return { data: [] as unknown[] };
  const res = await supabase
    .from("email_messages")
    .select(
      "id, order_id, to_email, status, error, sent_at, delivered_at, opened_at, bounced_at, complained_at, created_at"
    )
    .eq("category", "ticket_confirmation")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });
  if (res.error) return { data: [] as unknown[] };
  return res;
}
