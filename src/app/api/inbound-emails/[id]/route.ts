import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageComms } from "@/lib/api-auth";
import {
  INBOUND_STATUSES,
  setInboundStatus,
  type InboundStatus,
} from "@/services/inbound-emails";

// PATCH /api/inbound-emails/[id] — { status } : mark a reply read / handled /
// archived (or back to new). RLS (migration 228) also enforces who may.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageComms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !INBOUND_STATUSES.includes(body.status as InboundStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data, error } = await setInboundStatus(
    supabase,
    id,
    body.status as InboundStatus,
    user.id
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ email: data });
}
