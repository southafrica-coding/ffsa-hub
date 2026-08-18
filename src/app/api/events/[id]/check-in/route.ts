import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { logActivity } from "@/services/activity-events";

// POST /api/events/[id]/check-in
// Body: { code: string }
//
// Validates the scanned/typed code against this event's tickets,
// and on a successful match flips status valid -> checked_in
// (optimistic guard on status='valid' makes this idempotent for
// concurrent scans). Returns a discriminated result the scanner
// UI renders colour-coded.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_attendance"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const TICKET_COLUMNS =
    "id, status, event_id, checked_in_at, ticket_types(name), orders(buyer_first_name, buyer_last_name, buyer_contact_id)";

  const { data: exact } = await supabase
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("code", code)
    .maybeSingle();

  let ticket = exact;

  // Codes are base64url, so the QR path is always exact. Manual entry is
  // typed by a human at a door, though, and phone keyboards love to
  // capitalise — fall back to a case-insensitive match. LIKE wildcards are
  // escaped because "_" is a legal base64url character, and an ambiguous
  // match (two codes differing only in case) is rejected rather than
  // guessed at, so we never check in the wrong ticket.
  if (!ticket) {
    const escaped = code.replace(/([\\%_])/g, "\\$1");
    const { data: loose } = await supabase
      .from("tickets")
      .select(TICKET_COLUMNS)
      .ilike("code", escaped)
      .limit(2);
    if (loose?.length === 1) ticket = loose[0];
  }

  if (!ticket) {
    return NextResponse.json({ result: "invalid" });
  }
  if (ticket.event_id !== eventId) {
    return NextResponse.json({ result: "wrong_event" });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketTypeName = (ticket.ticket_types as any)?.name ?? "Ticket";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buyerOrder = ticket.orders as any;

  if (ticket.status === "void") {
    return NextResponse.json({ result: "void" });
  }
  if (ticket.status === "checked_in") {
    return NextResponse.json({
      result: "already_checked_in",
      ticketTypeName,
      checkedInAt: ticket.checked_in_at,
    });
  }

  // Flip to checked_in — optimistic guard handles concurrent scans.
  const { data: updated, error: updateErr } = await supabase
    .from("tickets")
    .update({
      status: "checked_in",
      checked_in_at: new Date().toISOString(),
      checked_in_by: user.id,
    })
    .eq("id", ticket.id)
    .eq("status", "valid")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  if (!updated) {
    // Either another door scanner beat us to it, or the write was filtered
    // out by RLS. Re-read to tell them apart — reporting a silently blocked
    // write as "already checked in" would hide a permissions problem behind
    // a screen that looks like everything is working.
    const { data: after } = await supabase
      .from("tickets")
      .select("status, checked_in_at")
      .eq("id", ticket.id)
      .maybeSingle();

    if (after?.status !== "checked_in") {
      return NextResponse.json(
        {
          error:
            "Check-in didn't save — your account may not have permission to check tickets in.",
        },
        { status: 500 }
      );
    }

    // Race: another door scanner beat us to it.
    return NextResponse.json({
      result: "already_checked_in",
      ticketTypeName,
      checkedInAt: after.checked_in_at ?? new Date().toISOString(),
    });
  }

  // Best-effort timeline entry on the buyer's contact (if resolved).
  if (buyerOrder?.buyer_contact_id) {
    await logActivity(supabase, {
      contact_id: buyerOrder.buyer_contact_id,
      event_type: "ticket_checked_in",
      related_user_id: user.id,
      payload: { ticket_id: ticket.id, event_id: eventId },
    });
  }

  const buyerName = buyerOrder
    ? `${buyerOrder.buyer_first_name} ${buyerOrder.buyer_last_name}`
    : "";

  return NextResponse.json({
    result: "ok",
    ticketTypeName,
    buyerName,
  });
}
