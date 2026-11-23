import { after, NextResponse } from "next/server";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";
import {
  CLASH_ERROR,
  createVehicleRequest,
  findVehicleClashes,
  nn,
  prepareDrivers,
  validateVehicleRequestFields,
  type RequestRefusal,
  type VehicleRequestBody,
} from "@/lib/vehicles/booking-request";

// The checks and the write live in lib/vehicles/booking-request, shared
// with the "Hub" Slack assistant so both refuse the same things.
function refusal(r: RequestRefusal) {
  const { ok: _ok, status, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return NextResponse.json(rest, { status });
}

// POST /api/vehicles/bookings — create a vehicle booking request.
// Pass { dryRun: true } to get availability/clash info without persisting.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.canRequest || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: VehicleRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fields = validateVehicleRequestFields(body);
  if (!fields.ok) return refusal(fields);

  // Availability over the requested window (live bookings only).
  const { unavailableIds, requestedIds, clashing } = await findVehicleClashes(
    createAdminClient(),
    fields.checkout,
    fields.ret,
    body.vehicle_ids
  );

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      unavailableVehicleIds: unavailableIds,
      clashingVehicleIds: clashing,
      blocked: clashing.length > 0,
    });
  }

  if (clashing.length > 0) {
    return NextResponse.json(
      { error: CLASH_ERROR, clashingVehicleIds: clashing, blocked: true },
      { status: 409 }
    );
  }

  // Requester display name fallback.
  let requesterName = nn(body.requester_name);
  if (!requesterName) {
    const { data: u } = await supabase
      .from("users")
      .select("first_name,last_name")
      .eq("id", user.id)
      .single();
    if (u) requesterName = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
  }

  // Hard block, server side. The form runs the same check, but a client can
  // post whatever it likes — this is the one that decides. Licence facts come
  // from the database, never from the request body.
  //
  // Runs BEFORE the booking row is inserted so a rejected request leaves
  // nothing behind.
  const prepared = await prepareDrivers(createAdminClient(), body.drivers, fields.ret);
  if (!prepared.ok) return refusal(prepared);

  const created = await createVehicleRequest(supabase, createAdminClient(), {
    userId: user.id,
    body,
    fields,
    requesterName,
    requestedIds,
    drivers: prepared.drivers,
    pendingTestUserIds: prepared.pendingTestUserIds,
  });
  if (!created.ok) return refusal(created);

  // Confirm receipt to the person who booked (Slack DM + email).
  after(() => notifyVehicleRequester({ bookingId: created.bookingId, kind: "submitted" }).then(() => undefined));

  return NextResponse.json({ ok: true, bookingId: created.bookingId, drivers: created.drivers });
}
