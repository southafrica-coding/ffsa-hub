// Approve / deny / complete a vehicle booking — one implementation shared by
// the Hub route and the Slack DM buttons, so both enforce the same licence
// re-check and send the same requester email.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateVehicleBooking,
  getBookingDrivers,
  getLicenceFactsFor,
  getVehicleBookingById,
  getOverlappingAssignments,
  setBookingVehicles,
} from "@/services/vehicles";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
import { sendVehicleRequestDecision } from "@/lib/email/send-vehicle-request";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type VehicleDecision = "approved" | "denied" | "completed";
export const VEHICLE_DECISIONS: VehicleDecision[] = ["approved", "denied", "completed"];

export type DecisionResult =
  | { ok: true }
  | { ok: false; error: string; status: number; blockedDriver?: string; reason?: string };

/**
 * `supabase` does the write (the session client in the Hub so RLS applies;
 * the admin client from Slack, where the caller was checked up front).
 */
export async function decideVehicleBooking(
  supabase: Client,
  userId: string,
  id: string,
  decision: VehicleDecision,
  rawNote: string | null | undefined
): Promise<DecisionResult> {
  const note = (rawNote ?? "").trim();

  // Approval re-checks every driver's licence against the database.
  //
  // Requests sit in the queue for days: a licence that was valid when the
  // request went in can have expired by the time someone approves it, and a
  // driver can be added to a booking after it was first submitted. Checking
  // only at request time would let both through.
  if (decision === "approved") {
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
              },
              booking?.return_date ?? null,
              "approval"
            )
          : ({ ok: false, reason: "no_licence", message: "No licence on file." } as const);
        if (!check.ok) {
          return {
            ok: false,
            error: `Can't approve — ${d.name} ${check.message.charAt(0).toLowerCase()}${check.message.slice(1)}`,
            status: 409,
            blockedDriver: d.id,
            reason: check.reason,
          };
        }
      }
    }
  }

  const { data: updated, error } = await updateVehicleBooking(supabase, id, {
    status: decision,
    decision_note: note.length ? note : null,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message, status: 500 };

  // Email the requester on approve/deny (covers public requesters who have no
  // in-app feed). Best-effort — a mail failure never fails the decision.
  if (updated?.requester_email && (decision === "approved" || decision === "denied")) {
    await sendVehicleRequestDecision({
      email: updated.requester_email,
      requesterName: updated.requester_name,
      bookingName: updated.booking_name,
      checkoutDate: updated.checkout_date,
      returnDate: updated.return_date,
      approved: decision === "approved",
      note: note.length ? note : null,
    });
  }

  return { ok: true };
}

/**
 * Replace a booking's vehicles, refusing any vehicle already held by another
 * pending / approved booking over the same dates (same rule as the Hub).
 */
export async function assignVehiclesChecked(
  admin: Client,
  booking: { id: string; checkout_date: string; return_date: string },
  vehicleIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const overlapping = await getOverlappingAssignments(admin, booking.checkout_date, booking.return_date, booking.id);
  const unavailable = new Set(overlapping.map((a) => a.vehicle_id));
  if (vehicleIds.some((v) => unavailable.has(v))) {
    return { ok: false, error: "One or more of those vehicles is already booked for an overlapping period." };
  }
  const { error } = await setBookingVehicles(admin, booking.id, vehicleIds);
  return error ? { ok: false, error: error.message } : { ok: true };
}
