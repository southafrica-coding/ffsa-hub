import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess, getVehicleBookingById } from "@/services/vehicles";
import { messageRequesterAsSender } from "@/lib/vehicles/requester-notify";

// POST /api/vehicles/bookings/[id]/messages — a vehicle manager writes to the
// person who booked. Sent from the manager's own Slack account (they connect
// it once), so the reply comes straight back to them; email only if the
// requester isn't on Slack. 409 { needsConnect } until they've connected.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: booking } = await getVehicleBookingById(supabase, id);
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (text.length > 3000) {
    return NextResponse.json({ error: "Keep the message under 3,000 characters." }, { status: 400 });
  }

  const sent = await messageRequesterAsSender({ bookingId: id, text, senderId: user.id });
  if (!sent.ok) {
    if (sent.needsConnect) {
      return NextResponse.json(
        { error: "Connect your Slack first so the message comes from you.", needsConnect: true },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: sent.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true, via: sent.via });
}
