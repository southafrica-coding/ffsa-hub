import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_CREATE_GATE } from "@/lib/auth/event-access";
import type { WaiverSignatureRecord } from "@/lib/ticketing/waivers";

// GET /api/tickets/[code]/waiver
//   ?doc=certificate  → the generated signed certificate (default)
//   ?doc=blank        → the original blank form the tier had uploaded
//
// Admin-only — unlike the QR route, these are consent documents naming
// minors, so we require an authenticated organizer (canManageEvents) and
// stream from the private bucket via the service-role client.
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // The ticket code is not an event id. Read event_id as the caller first.
  // Tickets SELECT is events.view, so a create-only organizer may not see
  // the row; an id-only service-role probe then distinguishes a missing
  // ticket from one outside their scope. The file itself is downloaded
  // only after the gate.
  const { data: visible } = await supabase
    .from("tickets")
    .select("id, event_id")
    .eq("code", code)
    .maybeSingle();
  let eventId = (visible?.event_id as string | null) ?? null;
  if (!eventId) {
    const { data: hidden } = await createAdminClient()
      .from("tickets")
      .select("id, event_id")
      .eq("code", code)
      .maybeSingle();
    if (!hidden?.event_id) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    eventId = hidden.event_id as string;
    if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  } else if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const which =
    new URL(request.url).searchParams.get("doc") === "blank"
      ? "blank"
      : "certificate";

  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("tickets")
    .select("id, waiver_signature, ticket_types(waiver)")
    .eq("code", code)
    .maybeSingle();
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  const sig = (ticket.waiver_signature ?? null) as WaiverSignatureRecord | null;
  const tierWaiver = (
    ticket as { ticket_types?: { waiver?: { document_path?: string | null; document_name?: string | null } | null } }
  ).ticket_types?.waiver;

  const path =
    which === "blank"
      ? tierWaiver?.document_path ?? null
      : sig?.certificate_path ?? null;
  if (!path) {
    return NextResponse.json(
      { error: "No waiver document for this ticket." },
      { status: 404 }
    );
  }

  const { data: blob, error } = await admin.storage
    .from("waiver-documents")
    .download(path);
  if (error || !blob) {
    return NextResponse.json({ error: "Document unavailable" }, { status: 404 });
  }

  const filename =
    which === "blank"
      ? tierWaiver?.document_name ?? `waiver-${code}.pdf`
      : `signed-waiver-${code}.pdf`;
  const arrayBuffer = await blob.arrayBuffer();
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
