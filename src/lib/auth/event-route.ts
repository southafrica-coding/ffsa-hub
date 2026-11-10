import { NextResponse } from "next/server";
import {
  ORDERS_GATE,
  canManageEvent,
  readEventId,
  resolveOrderEventId,
  writeBlocked,
  type EventGate,
} from "@/lib/auth/event-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export function notAuthorized() {
  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}

/** Null when the caller may act on this event. Otherwise a 403 response. */
export async function gateEvent(
  supabase: Client,
  userId: string,
  eventId: string | null,
  gate: EventGate
): Promise<NextResponse | null> {
  const ok = await canManageEvent(supabase, userId, gate.keys, eventId, {
    bypassRoles: gate.bypassRoles,
    allowCreator: gate.allowCreator,
  });
  return ok ? null : notAuthorized();
}

/**
 * Authorise against the child row's own event_id. A URL event id that
 * doesn't match the row is 403, before any write. A row the caller cannot
 * see falls through to the URL event, and a later 0-row write is 403.
 */
export async function gateChildRow(
  supabase: Client,
  userId: string,
  urlEventId: string,
  table: string,
  rowId: string,
  gate: EventGate
): Promise<NextResponse | null> {
  const actual = await readEventId(supabase, table, rowId);
  if (actual && actual.toLowerCase() !== urlEventId.toLowerCase()) return notAuthorized();
  return gateEvent(supabase, userId, actual ?? urlEventId, gate);
}

/** 403 for an RLS denial or a write that changed nothing. Null to continue. */
export function blockWrite(
  error: { code?: string; message?: string } | null | undefined,
  data?: unknown
): NextResponse | null {
  return writeBlocked(error, data) ? notAuthorized() : null;
}

/**
 * Refunds and other order mutations. The event id comes from the order
 * row, and it has to be the event in the URL. Returns the response to
 * send, or the resolved event id when the caller may continue — and
 * never after a payment, mail, or Xero call.
 */
export async function gateOrder(
  supabase: Client,
  userId: string,
  urlEventId: string,
  orderId: string
): Promise<{ response: NextResponse } | { eventId: string }> {
  const resolved = await resolveOrderEventId(supabase, orderId);
  if ("status" in resolved) {
    return {
      response: NextResponse.json(
        { error: resolved.status === 404 ? "Order not found" : "Not authorized" },
        { status: resolved.status }
      ),
    };
  }
  if (resolved.eventId.toLowerCase() !== urlEventId.toLowerCase()) {
    return { response: notAuthorized() };
  }
  const denied = await gateEvent(supabase, userId, resolved.eventId, ORDERS_GATE);
  if (denied) return { response: denied };
  return { eventId: resolved.eventId };
}
