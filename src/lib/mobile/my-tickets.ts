// ============================================================
// GET /api/mobile/my-tickets — response contract (pure, tested)
// ============================================================
// The phone app's "My tickets": every ticket the caller bought, plus the
// event registrations that have no ticket (free / form-based sign-ups,
// which the website's /my-events page lists).
//
// Deliberately minimal: no prices, no buyer email/phone, no waiver
// guardian/minor details or IP. The waiver only says whether it is needed
// and signed; the signed PDF is fetched separately through
// /api/mobile/my-tickets/[code]/waiver.
// ============================================================

export type MyTicketEvent = {
  id: string;
  title: string;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  location: string | null;
  status: string;
};

export type MyTicket = {
  id: string;
  code: string;
  status: "valid" | "checked_in" | "void";
  checkedInAt: string | null;
  ticketTypeName: string;
  holderName: string;
  waiver: {
    required: boolean;
    signed: boolean;
    signedAt: string | null;
    title: string | null;
    hasDocument: boolean;
  };
  event: MyTicketEvent;
};

export type MyRegistration = {
  id: string;
  status: string;
  event: MyTicketEvent;
};

export type MyTicketsPayload = {
  tickets: MyTicket[];
  registrations: MyRegistration[];
  serverTime: string;
};

// ── Row shapes as read by services/my-tickets.ts ───────────

export type EventRow = {
  id: string;
  title: string;
  start_date: string;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  location?: string | null;
  status?: string | null;
};

export type OrderRow = { id: string; buyer_first_name: string | null; buyer_last_name: string | null };

export type TicketRow = {
  id: string;
  code: string;
  status: string;
  checked_in_at: string | null;
  order_id: string;
  waiver_signature: unknown;
  ticket_types: { name?: string | null; waiver?: unknown } | null;
  events: EventRow | null;
};

export type RegistrationRow = {
  id: string;
  status: string;
  order_id?: string | null;
  events: EventRow | null;
};

const TICKET_STATUSES = new Set(["valid", "checked_in", "void"]);

function shapeEvent(e: EventRow): MyTicketEvent {
  return {
    id: e.id,
    title: e.title,
    startDate: e.start_date,
    startTime: e.start_time ?? null,
    endDate: e.end_date ?? null,
    endTime: e.end_time ?? null,
    location: e.location ?? null,
    status: e.status ?? "published",
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Waiver state for one ticket — status only, never the signed details. */
export function shapeWaiver(tierWaiver: unknown, signature: unknown): MyTicket["waiver"] {
  const tier = record(tierWaiver);
  const sig = record(signature);
  const signedAt = str(sig?.signed_at);
  return {
    required: tier?.enabled === true,
    signed: !!signedAt,
    signedAt,
    title: str(sig?.title) ?? str(tier?.title),
    hasDocument: !!str(sig?.certificate_path),
  };
}

export function holderName(order: OrderRow | undefined): string {
  if (!order) return "";
  return `${order.buyer_first_name ?? ""} ${order.buyer_last_name ?? ""}`.trim();
}

/** Upcoming first (soonest at the top), then the rest by date. */
function byEventDate(a: { event: MyTicketEvent }, b: { event: MyTicketEvent }) {
  const ka = `${a.event.startDate}T${a.event.startTime ?? "00:00"}`;
  const kb = `${b.event.startDate}T${b.event.startTime ?? "00:00"}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function buildMyTicketsPayload(input: {
  orders: OrderRow[];
  tickets: TicketRow[];
  registrations: RegistrationRow[];
  now: Date;
}): MyTicketsPayload {
  const orders = new Map(input.orders.map((o) => [o.id, o]));

  const tickets: MyTicket[] = [];
  for (const t of input.tickets) {
    // An event deleted under a ticket can't be shown usefully; skip it.
    if (!t.events || !orders.has(t.order_id)) continue;
    tickets.push({
      id: t.id,
      code: t.code,
      status: (TICKET_STATUSES.has(t.status) ? t.status : "void") as MyTicket["status"],
      checkedInAt: t.checked_in_at,
      ticketTypeName: t.ticket_types?.name ?? "Ticket",
      holderName: holderName(orders.get(t.order_id)),
      waiver: shapeWaiver(t.ticket_types?.waiver, t.waiver_signature),
      event: shapeEvent(t.events),
    });
  }

  // A paid order also writes a registration for the buyer; that event is
  // already represented by its tickets, so list only the ticketless ones.
  const ticketedEvents = new Set(tickets.map((t) => t.event.id));
  const registrations: MyRegistration[] = input.registrations
    .filter((r) => r.events && !ticketedEvents.has(r.events.id))
    .map((r) => ({ id: r.id, status: r.status, event: shapeEvent(r.events as EventRow) }));

  return {
    tickets: tickets.sort(byEventDate),
    registrations: registrations.sort(byEventDate),
    serverTime: input.now.toISOString(),
  };
}

/** YYYY-MM-DD for the day before `now` (UTC) — check-in list lower bound. */
export function checkInWindowStart(now: Date): string {
  const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
