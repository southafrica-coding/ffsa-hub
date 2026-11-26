import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { alternatives } from "@/lib/fleet/rules";
import { getBookingRequestedBy, moveBookingAssignment } from "@/services/fleet";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { refreshVehicleRequestAlerts } from "@/lib/vehicles/slack-alerts";
import { vehicleChangedLine } from "@/lib/fleet/move-notice";
import { restOf } from "@/lib/fleet/out-of-action";

// POST /api/vehicles/fleet/trips/move — the Calendar's "Move <trip> to <vehicle>" on a
// clash. A trip is a Hub booking's vehicle assignment (id "<booking id>:<vehicle id>").
// Only to a similar vehicle that's free for the whole trip (the app's alternatives()).
//
// Like a vehicle change made on the booking page, the person who booked is told straight
// away (Slack DM + email, with the booking details and an "Open in Hub" link, logged on the
// booking), and a still-open Slack request message is brought up to date (Jack, 19 Nov).
// This is the Hub's own booking notice, not a Fleet message, so FLEET_MESSAGES_ENABLED
// doesn't apply; nothing here can fail the move.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const b = await readJson<{ tripId?: string; to?: string }>(request);
  const [bookingId, fromId] = String(b?.tripId || "").split(":");
  const to = b?.to;
  if (!isUuid(bookingId) || !isUuid(fromId) || !isUuid(to)) return bad("Unknown trip or vehicle");

  const { F } = await loadFleet(auth.supabase);
  const trip = F.trips.find((t) => t.id === `${bookingId}:${fromId}`);
  if (!trip) return bad("Unknown trip", 404);
  // A booking already under way only needs the new vehicle for the rest of it (Fleet 5c).
  const target = alternatives(F, restOf(trip, F.today)).find((v) => v.id === to);
  if (!target) return bad("That vehicle isn't free for the whole trip, or isn't a similar vehicle.", 409);
  const fromName = F.vehicles.find((v) => v.id === fromId)?.name ?? "your vehicle";

  const { data, error } = await moveBookingAssignment(auth.supabase, bookingId, fromId, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return bad("The booking isn't on that vehicle any more.", 409);
  await logTime(auth.supabase, auth.user.id, { kind: "trip", vehicleId: to, mins: 2 });

  // Their own move needs no announcement (the booking page does the same).
  const { data: owner } = await getBookingRequestedBy(auth.supabase, bookingId);
  let told = false;
  if (owner?.requested_by !== auth.user.id) {
    const sent = await notifyVehicleRequester({
      bookingId,
      kind: "changed",
      changes: [vehicleChangedLine(fromName, target.name)],
      sentBy: auth.user.id,
    });
    told = sent.slack || sent.email;
  }
  await refreshVehicleRequestAlerts(bookingId);

  const message = told
    ? `Moved to ${target.name}. The person who booked it has been told.`
    : owner?.requested_by === auth.user.id
      ? `Moved to ${target.name}.`
      : `Moved to ${target.name}. Couldn't reach the person who booked it, so let them know yourself.`;
  return NextResponse.json({ success: true, message, told });
}
