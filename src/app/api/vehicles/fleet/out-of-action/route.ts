import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { cancelBookingBrokenDown, getBookingRequestedBy, setBookingHold } from "@/services/fleet";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { refreshVehicleRequestAlerts } from "@/lib/vehicles/slack-alerts";
import { noticeText, outOfAction } from "@/lib/fleet/out-of-action";

type Action = "hold" | "resume" | "cancel";

// POST /api/vehicles/fleet/out-of-action — Fleet part 5c: a booking whose vehicle is out of
// action (in for a repair, or broken down) and has no similar vehicle free. Body:
// { action: "hold" | "resume" | "cancel", bookingId }.
//   hold    the booking waits until the vehicle is back (a repair, usually)
//   resume  the vehicle's back: the booking carries on
//   cancel  "Vehicle broke down": the booking is cancelled
// Each tells the person who booked through the Hub's booking notice (not for your own
// booking), only because the co-ordinator tapped it. Swapping to a free vehicle is Move.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const b = await readJson<{ action?: string; bookingId?: string }>(request);
  const action = b?.action as Action;
  const bookingId = b?.bookingId;
  if (!["hold", "resume", "cancel"].includes(action) || !isUuid(bookingId)) return bad("Unknown action or booking");

  const { F } = await loadFleet(auth.supabase);
  const out = outOfAction(F);
  const affected = out.vehicles.flatMap((v) => v.bookings.map((x) => ({ v, x }))).find((y) => y.x.bookingId === bookingId);
  const waiting = out.resume.find((r) => r.bookingId === bookingId);

  let note: string;
  let kind: "changed" | "cancelled";
  if (action === "resume") {
    if (!waiting) return bad("That booking isn’t on hold, or its vehicle is still out of action.", 409);
    const { error } = await setBookingHold(auth.supabase, bookingId, null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    note = noticeText.resume(waiting.vehicleName);
    kind = "changed";
  } else {
    if (!affected) return bad("That booking isn’t on a vehicle that’s out of action any more.", 409);
    if (affected.x.swaps.length) return bad("A similar vehicle is free: Move the booking instead.", 409);
    if (action === "hold") {
      if (affected.x.onHold) return bad("That booking is already on hold.", 409);
      note = noticeText.hold(affected.v.name, affected.v.kind);
      const { error } = await setBookingHold(auth.supabase, bookingId, { since: F.today, reason: note });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      kind = "changed";
    } else {
      note = noticeText.cancel(affected.v.name);
      const { data, error } = await cancelBookingBrokenDown(auth.supabase, bookingId, note);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return bad("That booking can’t be cancelled any more.", 409);
      kind = "cancelled";
    }
  }
  await logTime(auth.supabase, auth.user.id, { kind: "trip", vehicleId: affected?.v.id ?? null, mins: 2 });

  const { data: owner } = await getBookingRequestedBy(auth.supabase, bookingId);
  let told = false;
  if (owner?.requested_by !== auth.user.id) {
    const sent = await notifyVehicleRequester(kind === "cancelled" ? { bookingId, kind, note, sentBy: auth.user.id } : { bookingId, kind, changes: [note], sentBy: auth.user.id });
    told = sent.slack || sent.email;
  }
  await refreshVehicleRequestAlerts(bookingId);

  const done = { hold: "On hold until the vehicle is back.", resume: "Back on: the booking carries on.", cancel: "Booking cancelled." }[action];
  const message =
    owner?.requested_by === auth.user.id ? done : told ? `${done} The person who booked it has been told.` : `${done} Couldn’t reach the person who booked it, so let them know yourself.`;
  return NextResponse.json({ success: true, told, message });
}
