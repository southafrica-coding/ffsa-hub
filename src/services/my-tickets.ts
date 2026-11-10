// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// My tickets — the signed-in person's own tickets (phone app)
// ────────────────────────────────────────────────────────────
// RLS only lets admins / events staff read `orders` and `tickets`, so a
// student can't read their own ticket rows directly. The routes under
// /api/mobile/my-tickets authenticate the caller, resolve THEIR contact id
// through their own client, and only then read with the service-role
// client — always filtered to that one contact's orders.

export const MY_TICKET_COLUMNS =
  "id, code, status, checked_in_at, order_id, waiver_signature, ticket_types(name, waiver), events(id, title, start_date, start_time, end_date, end_time, location, status)";

/** The caller's own users row → contact id. Pass the caller's RLS client. */
export async function getMyContactId(supabase: Client, userId: string) {
  return supabase.from("users").select("contact_id").eq("id", userId).maybeSingle();
}

/** Orders bought by one contact. Service-role client; scope is the filter. */
export async function listOrdersForContact(admin: Client, contactId: string) {
  return admin
    .from("orders")
    .select("id, buyer_first_name, buyer_last_name")
    .eq("buyer_contact_id", contactId);
}

/** Orders by id (for registrations that point at an order). */
export async function listOrdersByIds(admin: Client, orderIds: string[]) {
  return admin
    .from("orders")
    .select("id, buyer_first_name, buyer_last_name")
    .in("id", orderIds);
}

/** Every ticket on the given orders, with its event and tier. */
export async function listTicketsForOrders(admin: Client, orderIds: string[]) {
  return admin.from("tickets").select(MY_TICKET_COLUMNS).in("order_id", orderIds);
}

/** One ticket by code, with only what an ownership + waiver check needs. */
export async function getTicketForWaiver(admin: Client, code: string) {
  return admin
    .from("tickets")
    .select("id, order_id, waiver_signature")
    .eq("code", code)
    .maybeSingle();
}

/** Short-lived link to a document in the private waiver bucket. */
export async function createWaiverSignedUrl(admin: Client, path: string, expiresInSeconds: number) {
  return admin.storage.from("waiver-documents").createSignedUrl(path, expiresInSeconds);
}

// ────────────────────────────────────────────────────────────
// Door check-in — which events can be run from the phone
// ────────────────────────────────────────────────────────────

/**
 * Ticketed, published events that haven't finished before `fromDate`
 * (YYYY-MM-DD). Multi-day events stay listed until their end date.
 */
export async function listCheckInEvents(
  admin: Client,
  fromDate: string,
  limit = 50,
  ids?: string[]
) {
  let query = admin
    .from("events")
    .select("id, title, start_date, start_time, end_date, end_time, location")
    .eq("ticketing_enabled", true)
    .eq("status", "published")
    .or(`end_date.gte.${fromDate},and(end_date.is.null,start_date.gte.${fromDate})`);
  if (ids) query = query.in("id", ids);
  return query.order("start_date", { ascending: true }).limit(limit);
}
