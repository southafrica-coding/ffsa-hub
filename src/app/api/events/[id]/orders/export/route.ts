import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { getEventById } from "@/services/events";
import { listOrdersByEvent, listTicketTypesByEvent } from "@/services/ticketing";
import {
  ORDER_EXPORT_COLUMN_LABELS,
  parseOrderExportColumns,
  type OrderExportColumnKey,
} from "@/lib/ticketing/order-export-columns";

type OrderLine = { ticket_type_id: string; qty: number };

type OrderRow = {
  id: string;
  status: string;
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  subtotal_cents: number;
  discount_cents: number;
  donation_cents: number;
  total_cents: number;
  refund_cents: number;
  payment_provider: string | null;
  provider_reference: string | null;
  marketing_consent: boolean;
  staff_notes: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  cancelled_at: string | null;
  lines: unknown;
  promo_code_id: string | null;
};

function escapeCsvValue(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rands(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// "2× General, 1× Student" — resolves ticket-type ids to their names, falling
// back to the raw id if a type has since been deleted.
function ticketsSummary(
  lines: unknown,
  typeNames: Map<string, string>
): string {
  if (!Array.isArray(lines)) return "";
  return (lines as OrderLine[])
    .filter((l) => l && typeof l.ticket_type_id === "string")
    .map((l) => `${l.qty}× ${typeNames.get(l.ticket_type_id) ?? l.ticket_type_id}`)
    .join(", ");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();

  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (
    !(await canManageEvents(supabase, user.id, ["events.manage_registrations"]))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const selectedColumns = parseOrderExportColumns(searchParams.get("columns"));

  const { data: event } = await getEventById(supabase, eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const [{ data: orders }, { data: ticketTypes }] = await Promise.all([
    listOrdersByEvent(supabase, eventId),
    listTicketTypesByEvent(supabase, eventId),
  ]);

  const typeNames = new Map<string, string>(
    (ticketTypes ?? []).map((t: { id: string; name: string }) => [t.id, t.name])
  );

  const VALUE: Record<OrderExportColumnKey, (o: OrderRow) => string> = {
    order_id: (o) => o.id,
    reference: (o) => o.id.slice(0, 8),
    status: (o) => o.status,
    buyer_first_name: (o) => o.buyer_first_name ?? "",
    buyer_last_name: (o) => o.buyer_last_name ?? "",
    buyer_email: (o) => o.buyer_email ?? "",
    buyer_phone: (o) => o.buyer_phone ?? "",
    subtotal: (o) => rands(o.subtotal_cents),
    discount: (o) => rands(o.discount_cents),
    donation: (o) => rands(o.donation_cents),
    total: (o) => rands(o.total_cents),
    refunded: (o) => rands(o.refund_cents),
    tickets: (o) => ticketsSummary(o.lines, typeNames),
    payment_provider: (o) => o.payment_provider ?? "",
    provider_reference: (o) => o.provider_reference ?? "",
    promo_code: (o) => o.promo_code_id ?? "",
    marketing_consent: (o) => (o.marketing_consent ? "Yes" : "No"),
    created_at: (o) => formatDate(o.created_at),
    paid_at: (o) => formatDate(o.paid_at),
    refunded_at: (o) => formatDate(o.refunded_at),
    cancelled_at: (o) => formatDate(o.cancelled_at),
    staff_notes: (o) => o.staff_notes ?? "",
  };

  const headers = selectedColumns.map((k) => ORDER_EXPORT_COLUMN_LABELS[k]);
  const lines = [headers.map(escapeCsvValue).join(",")];

  for (const o of (orders ?? []) as OrderRow[]) {
    const cells = selectedColumns.map((k) => VALUE[k](o));
    lines.push(cells.map(escapeCsvValue).join(","));
  }

  const csv = lines.join("\n");
  const filename = `orders-${slugify(event.title) || "event"}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
