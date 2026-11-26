import { NextResponse } from "next/server";
import { bad, fleetAuth, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { visitNotices } from "@/lib/fleet/rules";
import { getBookingRequestedBy } from "@/services/fleet";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";

// POST /api/vehicles/fleet/notices — "Let them know" on a clash or heads-up (SPEC 7.3,
// Fleet part 5b). Tells the person who booked about a workshop visit on, or just before,
// their booking: the vehicle, the dates, similar free vehicles or "wait until it's back".
// Only when the co-ordinator taps it, and through the Hub's own booking notice (Slack DM,
// else email; logged on the booking), like Move. Body: { bookingId, visitId }.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const b = await readJson<{ bookingId?: string; visitId?: string }>(request);
  const bookingId = String(b?.bookingId || "");
  const visitId = String(b?.visitId || "");
  if (!bookingId || !visitId) return bad("Unknown booking or workshop visit");

  const { F } = await loadFleet(auth.supabase);
  const notice = visitNotices(F, visitId).find((n) => n.bookingId === bookingId);
  if (!notice) return bad("That booking no longer clashes with this workshop visit.", 409);

  const { data: owner } = await getBookingRequestedBy(auth.supabase, bookingId);
  if (owner?.requested_by === auth.user.id) return NextResponse.json({ success: true, told: false, message: "That’s your own booking, so there’s no one to tell." });

  const sent = await notifyVehicleRequester({ bookingId, kind: "message", note: notice.text, sentBy: auth.user.id });
  await logTime(auth.supabase, auth.user.id, { kind: "trip", vehicleId: notice.vehicle.id, mins: 1 });
  const told = sent.slack || sent.email;
  return NextResponse.json({
    success: true,
    told,
    message: told ? "The person who booked has been told." : "Couldn’t reach the person who booked it, so let them know yourself.",
  });
}
