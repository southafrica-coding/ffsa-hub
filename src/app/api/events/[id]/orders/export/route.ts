import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { getEventById } from "@/services/events";
import {
  listOrdersWithTicketAnswersByEvent,
  listTicketTypesByEvent,
} from "@/services/ticketing";
import {
  formatAnswerValue,
  type CheckoutAnswerSnapshot,
} from "@/lib/ticketing/checkout-questions";
import type { TicketAnswerGroup } from "@/lib/ticketing/ticket-questions";
import type { FormField } from "@/lib/forms/schema";
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
  // Event-level checkout questions (migration 094) and the per-ticket
  // tier answers captured at checkout (migration 138).
  custom_answers: unknown;
  ticket_answers: unknown;
  tickets: TicketRow[] | null;
};

type TicketRow = {
  id: string;
  code: string;
  ticket_type_id: string;
  custom_answers: unknown;
  ticket_types: { name: string } | null;
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

// The union of every question label defined across a set of question
// schemas, in order, de-duplicated — one CSV column per label.
function questionLabels(schemas: Array<FormField[] | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const schema of schemas) {
    for (const q of schema ?? []) {
      const label = q.label?.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function snapshots(value: unknown): CheckoutAnswerSnapshot[] {
  return Array.isArray(value) ? (value as CheckoutAnswerSnapshot[]) : [];
}

// Per-ticket answers for one order, grouped by question label. An order can
// hold several tickets (e.g. three kids), so each label collects one value
// per ticket, joined with " | " in ticket order. Prefers the issued tickets'
// own answers and falls back to the order's checkout snapshot for orders
// whose tickets haven't been issued yet (pending / unpaid).
function ticketAnswersByLabel(o: OrderRow): Map<string, string[]> {
  const byLabel = new Map<string, string[]>();
  const push = (label: string, value: unknown) => {
    const list = byLabel.get(label) ?? [];
    list.push(formatAnswerValue(value));
    byLabel.set(label, list);
  };

  const issued = (o.tickets ?? []).filter(
    (t) => snapshots(t.custom_answers).length > 0
  );
  if (issued.length > 0) {
    for (const t of issued) {
      for (const a of snapshots(t.custom_answers)) push(a.label, a.value);
    }
    return byLabel;
  }

  const groups = Array.isArray(o.ticket_answers)
    ? (o.ticket_answers as TicketAnswerGroup[])
    : [];
  for (const g of groups) {
    for (const a of snapshots(g?.answers)) push(a.label, a.value);
  }
  return byLabel;
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
    listOrdersWithTicketAnswersByEvent(supabase, eventId),
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
    // Expanded into their own columns below, never a single cell.
    checkout_answers: () => "",
    ticket_answers: () => "",
  };

  // Dynamic answer columns. "Checkout Questions" expands into one column
  // per event-level question; "Per-Ticket Questions" into one column per
  // label across every tier's questions. Both keep their answers as real
  // columns rather than one blob, so the CSV filters and pivots.
  const wantsCheckoutAnswers = selectedColumns.includes("checkout_answers");
  const wantsTicketAnswers = selectedColumns.includes("ticket_answers");

  const checkoutLabels = wantsCheckoutAnswers
    ? questionLabels([(event as { checkout_questions?: FormField[] | null }).checkout_questions])
    : [];
  const tierLabels = wantsTicketAnswers
    ? questionLabels(
        ((ticketTypes ?? []) as Array<{ questions?: FormField[] | null }>).map(
          (t) => t.questions
        )
      )
    : [];

  const headers = selectedColumns.flatMap((k) => {
    if (k === "checkout_answers") return checkoutLabels;
    if (k === "ticket_answers") return tierLabels.map((l) => `Ticket: ${l}`);
    return [ORDER_EXPORT_COLUMN_LABELS[k]];
  });
  const lines = [headers.map(escapeCsvValue).join(",")];

  for (const o of (orders ?? []) as OrderRow[]) {
    const checkoutByLabel = new Map<string, unknown>();
    if (wantsCheckoutAnswers) {
      for (const a of snapshots(o.custom_answers)) {
        checkoutByLabel.set(a.label, a.value);
      }
    }
    const ticketByLabel = wantsTicketAnswers
      ? ticketAnswersByLabel(o)
      : new Map<string, string[]>();

    const cells = selectedColumns.flatMap((k) => {
      if (k === "checkout_answers") {
        return checkoutLabels.map((label) =>
          checkoutByLabel.has(label)
            ? formatAnswerValue(checkoutByLabel.get(label))
            : ""
        );
      }
      if (k === "ticket_answers") {
        return tierLabels.map((label) =>
          (ticketByLabel.get(label) ?? []).join(" | ")
        );
      }
      return [VALUE[k](o)];
    });
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
