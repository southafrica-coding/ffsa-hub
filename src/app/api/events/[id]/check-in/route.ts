import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import {
  checkInTicket,
  undoCheckIn,
  getDoorStats,
  searchGuests,
} from "@/services/ticket-check-in";

// The staff door. Same rules as the public /api/scan/[token] twin — both
// delegate to services/ticket-check-in so they cannot drift — but authorised
// by a Hub session and events.manage_attendance instead of a token.

async function authorise(eventId: string) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_attendance"]))) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { userId: user.id, eventId };
}

// GET ?stats=1 → door tally; GET ?q=name → guest lookup.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const auth = await authorise(eventId);
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q !== null) {
    return NextResponse.json({ guests: await searchGuests(admin, eventId, q) });
  }
  return NextResponse.json(await getDoorStats(admin, eventId));
}

// POST { code } → check in. POST { undo: ticketId } → reverse a check-in.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const auth = await authorise(eventId);
  if ("error" in auth) return auth.error;

  let body: { code?: string; undo?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (body.undo) {
    const res = await undoCheckIn(admin, eventId, body.undo);
    if (!res.ok) {
      return NextResponse.json({ error: res.reason }, { status: 400 });
    }
    return NextResponse.json({ result: "undone" });
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  try {
    const outcome = await checkInTicket(admin, eventId, code, {
      kind: "user",
      userId: auth.userId,
    });
    return NextResponse.json(outcome);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Check-in failed" },
      { status: 500 }
    );
  }
}
