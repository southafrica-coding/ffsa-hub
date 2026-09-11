import { logActivity } from "@/services/activity-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/**
 * Door check-in, shared by the two ways a door can be run.
 *
 * Staff scan from /events/[id]/check-in with a Hub session; a welcome-team
 * volunteer scans from the public /scan/[token] page with no account at all.
 * Both paths must agree on what a valid ticket is, what counts as a
 * double-scan, and what the door is allowed to see — so the rules live here
 * once and the route handlers only do authorisation.
 *
 * `scanner` is how the scan gets attributed: a Hub user, or a self-declared
 * name plus the link it came through. The name is NOT verified — it is an
 * audit trail for the organiser, never an identity claim.
 */
export type Scanner =
  | { kind: "user"; userId: string }
  | { kind: "link"; linkId: string; name: string | null };

export type ScanOutcome =
  | { result: "ok"; ticketId: string; ticketTypeName: string; buyerName: string }
  | { result: "already_checked_in"; ticketTypeName: string; checkedInAt: string }
  | { result: "void" | "invalid" | "wrong_event" };

function attribution(scanner: Scanner) {
  return scanner.kind === "user"
    ? { checked_in_by: scanner.userId, checked_in_by_name: null, checked_in_via_link: null }
    : {
        checked_in_by: null,
        checked_in_by_name: scanner.name,
        checked_in_via_link: scanner.linkId,
      };
}

function scannerLabel(scanner: Scanner): string | null {
  return scanner.kind === "link" ? scanner.name : null;
}

/**
 * Validate a scanned/typed code against one event and, on a match, flip
 * valid -> checked_in.
 *
 * The update is guarded on status='valid', which makes it idempotent under
 * concurrent scans: two doors scanning the same ticket at once produce one
 * check-in and one "already in", never two check-ins.
 */
export async function checkInTicket(
  admin: Client,
  eventId: string,
  code: string,
  scanner: Scanner
): Promise<ScanOutcome> {
  const { data: ticket } = await admin
    .from("tickets")
    .select(
      "id, status, event_id, checked_in_at, ticket_types(name), orders(buyer_first_name, buyer_last_name, buyer_contact_id)"
    )
    .eq("code", code)
    .maybeSingle();

  if (!ticket) return { result: "invalid" };
  if (ticket.event_id !== eventId) return { result: "wrong_event" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketTypeName = (ticket.ticket_types as any)?.name ?? "Ticket";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buyerOrder = ticket.orders as any;

  if (ticket.status === "void") return { result: "void" };
  if (ticket.status === "checked_in") {
    return {
      result: "already_checked_in",
      ticketTypeName,
      checkedInAt: ticket.checked_in_at,
    };
  }

  const { data: updated, error } = await admin
    .from("tickets")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      ...attribution(scanner),
    })
    .eq("id", ticket.id)
    .eq("status", "valid")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) {
    // Race: another door scanner beat us to it by milliseconds.
    return {
      result: "already_checked_in",
      ticketTypeName,
      checkedInAt: new Date().toISOString(),
    };
  }

  // Best-effort timeline entry on the buyer's contact (if resolved).
  if (buyerOrder?.buyer_contact_id) {
    await logActivity(admin, {
      contact_id: buyerOrder.buyer_contact_id,
      event_type: "ticket_checked_in",
      related_user_id: scanner.kind === "user" ? scanner.userId : null,
      payload: {
        ticket_id: ticket.id,
        event_id: eventId,
        scanned_by_name: scannerLabel(scanner),
      },
    });
  }

  return {
    result: "ok",
    ticketId: ticket.id,
    ticketTypeName,
    buyerName: buyerOrder
      ? `${buyerOrder.buyer_first_name} ${buyerOrder.buyer_last_name}`.trim()
      : "",
  };
}

/**
 * Reverse a check-in — the "sorry, wrong person" case at a busy door.
 *
 * Only ever flips checked_in -> valid, and only for a ticket belonging to
 * this event: it cannot void a ticket or resurrect one that was refunded.
 */
export async function undoCheckIn(
  admin: Client,
  eventId: string,
  ticketId: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data: updated, error } = await admin
    .from("tickets")
    .update({
      status: "valid",
      checked_in_at: null,
      checked_in_by: null,
      checked_in_by_name: null,
      checked_in_via_link: null,
    })
    .eq("id", ticketId)
    .eq("event_id", eventId)
    .eq("status", "checked_in")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };
  if (!updated) {
    return { ok: false, reason: "That ticket isn't checked in any more." };
  }
  return { ok: true };
}

export type DoorStats = { checkedIn: number; total: number };

/** Running tally for the door — counts only, never the list. */
export async function getDoorStats(
  admin: Client,
  eventId: string
): Promise<DoorStats> {
  const [{ count: total }, { count: checkedIn }] = await Promise.all([
    admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .neq("status", "void"),
    admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "checked_in"),
  ]);
  return { checkedIn: checkedIn ?? 0, total: total ?? 0 };
}

export type GuestMatch = {
  ticketId: string;
  code: string;
  name: string;
  ticketTypeName: string;
  status: "valid" | "checked_in";
  checkedInAt: string | null;
};

/**
 * Find a guest by name when their QR won't scan or was never opened.
 *
 * Deliberately name-only on the way in AND on the way out: no email, no
 * phone, no order total. A door needs to know that "Sarah Mokoena" holds a
 * General ticket — it does not need her contact details, and this list is
 * reachable by anyone holding the shared link.
 */
export async function searchGuests(
  admin: Client,
  eventId: string,
  query: string,
  limit = 12
): Promise<GuestMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Tokenised: "sarah mok" should match first_name=Sarah last_name=Mokoena,
  // which a single ilike over either column alone never does.
  const terms = q.split(/\s+/).slice(0, 3);

  let builder = admin
    .from("tickets")
    .select(
      "id, code, status, checked_in_at, ticket_types(name), orders!inner(buyer_first_name, buyer_last_name)"
    )
    .eq("event_id", eventId)
    .neq("status", "void")
    .limit(limit);

  for (const term of terms) {
    const safe = term.replace(/[%,()]/g, "");
    if (!safe) continue;
    builder = builder.or(
      `buyer_first_name.ilike.%${safe}%,buyer_last_name.ilike.%${safe}%`,
      { referencedTable: "orders" }
    );
  }

  const { data } = await builder;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((t) => ({
    ticketId: t.id,
    code: t.code,
    name: `${t.orders?.buyer_first_name ?? ""} ${t.orders?.buyer_last_name ?? ""}`.trim(),
    ticketTypeName: t.ticket_types?.name ?? "Ticket",
    status: t.status,
    checkedInAt: t.checked_in_at,
  }));
}
