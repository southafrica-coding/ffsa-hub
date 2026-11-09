import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, ORDERS_GATE } from "@/lib/auth/event-access";
import { sendCancellationNotice } from "@/services/event-cancellation-notice";

// POST /api/events/[id]/send-cancellation-notice
//
// Emails the already-refunded ticket holders of a cancelled event the
// event's cancellation_message, so they know WHY it was cancelled (the
// refund email only told them the money was coming back).
//
// Body:
//   dry_run  boolean  when true, returns the recipient list + rendered
//                      HTML preview WITHOUT sending anything.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvent(supabase, user.id, ORDERS_GATE.keys, id, ORDERS_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { dry_run?: unknown };
  const dryRun = body.dry_run === true;

  const result = await sendCancellationNotice(supabase, id, { dryRun });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }
  return NextResponse.json(result);
}
