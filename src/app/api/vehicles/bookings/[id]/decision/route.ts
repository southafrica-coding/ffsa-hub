import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess, updateVehicleBooking } from "@/services/vehicles";
import { sendVehicleRequestDecision } from "@/lib/email/send-vehicle-request";

type DecisionBody = { decision?: string; note?: string };

const ALLOWED = ["approved", "denied", "completed"];

// POST /api/vehicles/bookings/[id]/decision — approve / deny / complete.
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

  let body: DecisionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.decision || !ALLOWED.includes(body.decision)) {
    return NextResponse.json(
      { error: "decision must be one of: approved, denied, completed" },
      { status: 400 }
    );
  }

  const note = (body.note ?? "").trim();
  const { data: updated, error } = await updateVehicleBooking(supabase, id, {
    status: body.decision,
    decision_note: note.length ? note : null,
    decided_by: user.id,
    decided_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Email the requester on approve/deny (covers public requesters who have no
  // in-app feed). Best-effort — a mail failure never fails the decision.
  if (updated?.requester_email && (body.decision === "approved" || body.decision === "denied")) {
    await sendVehicleRequestDecision({
      email: updated.requester_email,
      requesterName: updated.requester_name,
      bookingName: updated.booking_name,
      checkoutDate: updated.checkout_date,
      returnDate: updated.return_date,
      approved: body.decision === "approved",
      note: note.length ? note : null,
    });
  }

  return NextResponse.json({ ok: true });
}
