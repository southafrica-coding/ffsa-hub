import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { alternatives } from "@/lib/fleet/rules";
import { moveBookingAssignment } from "@/services/fleet";

// POST /api/vehicles/fleet/trips/move — the Calendar's "Move <trip> to <vehicle>" on a
// clash. A trip is a Hub booking's vehicle assignment (id "<booking id>:<vehicle id>").
// Only to a similar vehicle that's free for the whole trip (the app's alternatives()).
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
  const target = alternatives(F, trip).find((v) => v.id === to);
  if (!target) return bad("That vehicle isn't free for the whole trip, or isn't a similar vehicle.", 409);

  const { data, error } = await moveBookingAssignment(auth.supabase, bookingId, fromId, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return bad("The booking isn't on that vehicle any more.", 409);
  await logTime(auth.supabase, auth.user.id, { kind: "trip", vehicleId: to, mins: 2 });
  return NextResponse.json({ success: true, message: `Moved to ${target.name}.` });
}
