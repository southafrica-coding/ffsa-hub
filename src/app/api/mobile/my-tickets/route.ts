import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getRegistrationsForContact } from "@/services/registrations";
import {
  getMyContactId,
  listOrdersByIds,
  listOrdersForContact,
  listTicketsForOrders,
} from "@/services/my-tickets";
import {
  buildMyTicketsPayload,
  type OrderRow,
  type RegistrationRow,
  type TicketRow,
} from "@/lib/mobile/my-tickets";

// GET /api/mobile/my-tickets — the phone app's "My tickets".
//
// Any signed-in person may call it, and it only ever returns THEIR tickets:
// the contact id comes from the caller's own users row (their RLS client),
// and every service-role read below is filtered to that contact's orders.
// Registrations are read through the caller's client, same as /my-events.
// Contract: src/lib/mobile/my-tickets.ts.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function serverError(message: string) {
  return NextResponse.json({ error: "server_error", message }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const me = await getMyContactId(supabase, user.id);
  if (me.error) return serverError(me.error.message);
  const contactId: string | null = me.data?.contact_id ?? null;
  if (!contactId) {
    return NextResponse.json(
      buildMyTicketsPayload({ orders: [], tickets: [], registrations: [], now: new Date() }),
      { headers: NO_STORE }
    );
  }

  const admin = createAdminClient();
  const [orders, registrations] = await Promise.all([
    listOrdersForContact(admin, contactId),
    getRegistrationsForContact(supabase, contactId),
  ]);
  if (orders.error) return serverError(orders.error.message);
  if (registrations.error) return serverError(registrations.error.message);

  const orderRows = (orders.data ?? []) as OrderRow[];
  const registrationRows = (registrations.data ?? []) as RegistrationRow[];

  // A registration can point at an order whose buyer contact hasn't been
  // resolved yet; it is still this person's order, so include it.
  const known = new Set(orderRows.map((o) => o.id));
  const extraIds = [
    ...new Set(
      registrationRows
        .map((r) => r.order_id)
        .filter((id): id is string => !!id && !known.has(id))
    ),
  ];
  if (extraIds.length > 0) {
    const extra = await listOrdersByIds(admin, extraIds);
    if (extra.error) return serverError(extra.error.message);
    orderRows.push(...((extra.data ?? []) as OrderRow[]));
  }

  let ticketRows: TicketRow[] = [];
  if (orderRows.length > 0) {
    const tickets = await listTicketsForOrders(
      admin,
      orderRows.map((o) => o.id)
    );
    if (tickets.error) return serverError(tickets.error.message);
    ticketRows = (tickets.data ?? []) as TicketRow[];
  }

  return NextResponse.json(
    buildMyTicketsPayload({
      orders: orderRows,
      tickets: ticketRows,
      registrations: registrationRows,
      now: new Date(),
    }),
    { headers: NO_STORE }
  );
}
