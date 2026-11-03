import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getRegistrationsForContact } from "@/services/registrations";
import {
  createWaiverSignedUrl,
  getMyContactId,
  getTicketForWaiver,
  listOrdersForContact,
} from "@/services/my-tickets";
import type { WaiverSignatureRecord } from "@/lib/ticketing/waivers";

// GET /api/mobile/my-tickets/[code]/waiver → { url, expiresIn }
//
// The ticket holder's own signed waiver certificate. /api/tickets/[code]/waiver
// is organiser-only and streams the PDF, which a phone's in-app browser
// can't fetch with a bearer token — so this returns a short-lived signed
// link instead, and ONLY for a ticket on one of the caller's own orders.
// Someone else's ticket answers exactly like a missing one (404).

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const LINK_SECONDS = 300;

// Same shape the public QR route accepts: base64url, 4–64 characters.
const codeSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return json({ error: "unauthenticated", message: "Sign in to use this endpoint." }, 401);
  }

  const parsed = codeSchema.safeParse(rawCode);
  if (!parsed.success) {
    return json({ error: "bad_request", message: "That isn't a ticket code." }, 400);
  }
  const code = parsed.data;
  const notFound = () => json({ error: "not_found", message: "Ticket not found." }, 404);

  const me = await getMyContactId(supabase, user.id);
  if (me.error) return json({ error: "server_error", message: me.error.message }, 500);
  const contactId: string | null = me.data?.contact_id ?? null;
  if (!contactId) return notFound();

  const admin = createAdminClient();
  const ticket = await getTicketForWaiver(admin, code);
  if (ticket.error) return json({ error: "server_error", message: ticket.error.message }, 500);
  if (!ticket.data) return notFound();

  const [orders, registrations] = await Promise.all([
    listOrdersForContact(admin, contactId),
    getRegistrationsForContact(supabase, contactId),
  ]);
  if (orders.error) return json({ error: "server_error", message: orders.error.message }, 500);
  if (registrations.error) {
    return json({ error: "server_error", message: registrations.error.message }, 500);
  }
  const owned = new Set<string>([
    ...((orders.data ?? []) as Array<{ id: string }>).map((o) => o.id),
    ...((registrations.data ?? []) as Array<{ order_id?: string | null }>)
      .map((r) => r.order_id)
      .filter((id): id is string => !!id),
  ]);
  if (!owned.has(ticket.data.order_id)) return notFound();

  const sig = (ticket.data.waiver_signature ?? null) as WaiverSignatureRecord | null;
  const path = sig?.certificate_path ?? null;
  if (!path) {
    return json(
      { error: "not_found", message: "There's no signed waiver for this ticket yet." },
      404
    );
  }

  const link = await createWaiverSignedUrl(admin, path, LINK_SECONDS);
  if (link.error || !link.data?.signedUrl) {
    return json({ error: "server_error", message: "Document unavailable." }, 500);
  }
  return json({ url: link.data.signedUrl, expiresIn: LINK_SECONDS }, 200);
}
