import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  updateVehicleBooking,
  getBookingDrivers,
  getLicenceFactsFor,
  getVehicleBookingById,
} from "@/services/vehicles";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
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

  // Approval re-checks every driver's licence against the database.
  //
  // Requests sit in the queue for days: a licence that was valid when the
  // request went in can have expired by the time someone approves it, and a
  // driver can be added to a booking after it was first submitted. Checking
  // only at request time would let both through.
  if (body.decision === "approved") {
    const { data: booking } = await getVehicleBookingById(supabase, id);
    const { data: drivers } = await getBookingDrivers(supabase, id);
    const linked = drivers.filter((d) => d.user_id);
    if (linked.length > 0) {
      const facts = await getLicenceFactsFor(
        createAdminClient(),
        linked.map((d) => d.user_id as string)
      );
      for (const d of linked) {
        const f = facts.get(d.user_id as string);
        const check = f
          ? checkDriverEligibility(
              {
                licence_expiry_date: f.expiry,
                licence_file_url: f.hasFile ? "on-file" : null,
                base_driving_test_status:
                  f.test as "not_required" | "pending" | "passed" | "failed",
                licence_kind: f.kind,
                licence_no_expiry: f.noExpiry,
              },
              booking?.return_date ?? null,
              "approval"
            )
          : ({ ok: false, reason: "no_licence", message: "No licence on file." } as const);
        if (!check.ok) {
          return NextResponse.json(
            {
              error: `Can't approve — ${d.name} ${check.message.charAt(0).toLowerCase()}${check.message.slice(1)}`,
              blockedDriver: d.id,
              reason: check.reason,
            },
            { status: 409 }
          );
        }
      }
    }
  }
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
