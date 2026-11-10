import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, REGISTRATIONS_GATE } from "@/lib/auth/event-access";
import { getEventById } from "@/services/events";
import { listTicketTypesByEvent } from "@/services/ticketing";
import {
  formatAnswerValue,
  type CheckoutAnswerSnapshot,
} from "@/lib/ticketing/checkout-questions";
import type { FormField } from "@/lib/forms/schema";
import type { TicketWaivedSteps } from "@/lib/ticketing/promo-codes";

// GET /api/events/[id]/attendees/export
//
// One row per issued ticket (paid orders only), with the buyer, tier, and
// ticket code, followed by a column for every per-tier question defined
// across the event's tiers (migration 137). This is the "roster" export —
// e.g. a Kids tier's "Child's name" / "Child's age" land as their own
// columns so staff get a clean per-child list.

type TicketRow = {
  code: string;
  status: string;
  checked_in_at: string | null;
  ticket_type_id: string;
  custom_answers: unknown;
  waiver_signature: unknown;
  // What a promo code waived for this ticket (migration 269).
  waived_steps: TicketWaivedSteps | null;
  ticket_types: { name: string } | null;
  orders: {
    id: string;
    buyer_first_name: string;
    buyer_last_name: string;
    buyer_email: string;
  } | null;
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

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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
    !(await canManageEvent(supabase, user.id, REGISTRATIONS_GATE.keys, eventId, REGISTRATIONS_GATE))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: event } = await getEventById(supabase, eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const [{ data: ticketTypes }, { data: tickets }] = await Promise.all([
    listTicketTypesByEvent(supabase, eventId),
    supabase
      .from("tickets")
      .select(
        "code, status, checked_in_at, ticket_type_id, custom_answers, waiver_signature, waived_steps, ticket_types(name), orders!inner(id, buyer_first_name, buyer_last_name, buyer_email, status)"
      )
      .eq("event_id", eventId)
      .in("status", ["valid", "checked_in"])
      .eq("orders.status", "paid")
      .order("created_at", { ascending: true }),
  ]);

  // Question columns: the union of every tier's question labels, in tier
  // (sort_order) then question order, de-duplicated by label so two tiers
  // sharing a label collapse into one column.
  const questionColumns: string[] = [];
  const seenLabels = new Set<string>();
  for (const t of (ticketTypes ?? []) as Array<{ questions?: FormField[] | null }>) {
    for (const q of t.questions ?? []) {
      const label = q.label?.trim();
      if (!label || seenLabels.has(label)) continue;
      seenLabels.add(label);
      questionColumns.push(label);
    }
  }

  // Waiver columns are added only when some tier on the event has a
  // waiver configured, so plain events keep a clean roster.
  const hasWaiver = ((ticketTypes ?? []) as Array<{ waiver?: { enabled?: boolean } | null }>).some(
    (t) => t.waiver?.enabled === true
  );
  const waiverHeaders = hasWaiver
    ? ["Waiver Signed", "Waiver Signed By", "Waiver Signed At", "Signed Waiver PDF"]
    : [];
  const siteBase = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com"
  ).replace(/\/$/, "");

  const ticketRows = (tickets ?? []) as unknown as TicketRow[];

  // A promo code can waive a ticket's waiver and some of its questions
  // (migration 269). Those cells read "Waived (CODE)" instead of blank so
  // staff can tell skipped from missing; the Promo Code column only
  // appears when some ticket was sold with a code.
  const hasPromo = ticketRows.some((t) => t.waived_steps?.promo_code);
  const questionLabelById = new Map<string, string>();
  for (const t of (ticketTypes ?? []) as Array<{ id: string; questions?: FormField[] | null }>) {
    for (const q of t.questions ?? []) {
      questionLabelById.set(`${t.id}:${q.id}`, q.label?.trim() ?? "");
    }
  }

  const baseHeaders = [
    "Order Reference",
    "First Name",
    "Last Name",
    "Email",
    "Tier",
    "Ticket Code",
    "Status",
    "Checked In At",
    ...(hasPromo ? ["Promo Code"] : []),
  ];
  const headers = [...baseHeaders, ...questionColumns, ...waiverHeaders];
  const lines = [headers.map(escapeCsvValue).join(",")];

  for (const t of ticketRows) {
    const answers = Array.isArray(t.custom_answers)
      ? (t.custom_answers as CheckoutAnswerSnapshot[])
      : [];
    // Last answer for a given label wins — labels are unique per tier, so
    // this only matters across tiers, and the column already merged them.
    const byLabel = new Map<string, unknown>();
    for (const a of answers) byLabel.set(a.label, a.value);
    const waived = t.waived_steps;
    const waivedNote = waived ? `Waived (${waived.promo_code})` : "";
    const waivedLabels = new Set(
      (waived?.question_ids ?? [])
        .map((id) => questionLabelById.get(`${t.ticket_type_id}:${id}`))
        .filter((l): l is string => !!l)
    );

    const base = [
      t.orders?.id.slice(0, 8) ?? "",
      t.orders?.buyer_first_name ?? "",
      t.orders?.buyer_last_name ?? "",
      t.orders?.buyer_email ?? "",
      t.ticket_types?.name ?? "",
      t.code,
      t.status,
      formatDate(t.checked_in_at),
      ...(hasPromo ? [waived?.promo_code ?? ""] : []),
    ];
    const questionCells = questionColumns.map((label) =>
      byLabel.has(label)
        ? formatAnswerValue(byLabel.get(label))
        : waivedLabels.has(label)
          ? waivedNote
          : ""
    );
    let waiverCells: string[] = [];
    if (hasWaiver) {
      const sig = (t.waiver_signature ?? null) as {
        guardian_name?: string;
        signed_at?: string;
        certificate_path?: string | null;
      } | null;
      waiverCells = sig
        ? [
            "Yes",
            sig.guardian_name ?? "",
            formatDate(sig.signed_at ?? null),
            sig.certificate_path
              ? `${siteBase}/api/tickets/${t.code}/waiver`
              : "",
          ]
        : waived?.waiver
          ? [waivedNote, "", "", ""]
          : ["", "", "", ""];
    }
    lines.push(
      [...base, ...questionCells, ...waiverCells].map(escapeCsvValue).join(",")
    );
  }

  const csv = lines.join("\n");
  const filename = `attendees-${slugify(event.title) || "event"}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
