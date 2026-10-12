import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageComms, COMMS_SEND_PERMS } from "@/lib/api-auth";
import { sendInboxReply } from "@/lib/email/inbox-reply";

export const runtime = "nodejs";

// POST /api/inbound-emails/[id]/reply — { body } : answer an inbound email
// from the Hub Inbox, as the team's work address (migration 229).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id, COMMS_SEND_PERMS))) {
    return NextResponse.json({ error: "Not authorized to send email" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as { body?: unknown };
  if (typeof payload.body !== "string") {
    return NextResponse.json({ error: "Write a reply first." }, { status: 400 });
  }
  if (payload.body.length > 50_000) {
    return NextResponse.json({ error: "That reply is too long." }, { status: 400 });
  }

  // Permission checked above with the user's session; the write fans out to
  // the ledger, timeline and inbox tables, so it runs as the service role.
  const result = await sendInboxReply(createAdminClient(), {
    inboundId: id,
    body: payload.body,
    userId: user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
