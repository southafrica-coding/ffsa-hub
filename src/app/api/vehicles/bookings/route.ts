import { after, NextResponse } from "next/server";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getOverlappingAssignments,
  insertVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
  getLicenceFactsFor,
  eligibilityInput,
  markDrivingTestPending,
} from "@/services/vehicles";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";

type DriverInput = {
  user_id?: string | null;
  name?: string;
  phone?: string;
  has_sa_license?: boolean;
  is_first_time?: boolean;
};

type CreateBody = {
  dryRun?: boolean;
  booking_name?: string;
  point_person?: string;
  purpose?: string;
  purpose_note?: string;
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  num_people?: number;
  checkout_date?: string;
  return_date?: string;
  home_country?: string;
  vehicle_ids?: string[];
  drivers?: DriverInput[];
  notes?: string;
};

const PURPOSES = [
  "international_team",
  "ministry",
  "airport_run",
  "personal",
  "other",
];

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
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

  let body: CreateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookingName = nn(body.booking_name);
  const checkout = nn(body.checkout_date);
  const ret = nn(body.return_date);
  const purpose = PURPOSES.includes(body.purpose ?? "") ? body.purpose! : "ministry";

  if (!bookingName) {
    return NextResponse.json({ error: "A booking name is required" }, { status: 400 });
  }
  if (!nn(body.point_person)) {
    return NextResponse.json({ error: "A point person is required" }, { status: 400 });
  }
  if (!checkout || !ret) {
    return NextResponse.json(
      { error: "Collection and return dates are required" },
      { status: 400 }
    );
  }
  if (ret < checkout) {
    return NextResponse.json(
      { error: "The return date must be on or after the collection date" },
      { status: 400 }
    );
  }

  // Availability over the requested window (live bookings only).
  const overlapping = await getOverlappingAssignments(
    createAdminClient(),
    checkout,
    ret
  );
  const unavailableIds = Array.from(new Set(overlapping.map((a) => a.vehicle_id)));

  const requestedIds = Array.isArray(body.vehicle_ids)
    ? body.vehicle_ids.filter((v): v is string => typeof v === "string")
    : [];
  // Hard block: a specific vehicle cannot be assigned to two overlapping bookings.
  const clashing = requestedIds.filter((id) => unavailableIds.includes(id));

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
      {
        error:
          "One or more of the chosen vehicles is already booked for an overlapping period. Pick different vehicles or adjust the dates.",
        clashingVehicleIds: clashing,
        blocked: true,
      },
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

  const drivers = (body.drivers ?? [])
    .map((d) => ({
      user_id: typeof d.user_id === "string" && d.user_id ? d.user_id : null,
      name: nn(d.name),
      phone: nn(d.phone),
      has_sa_license: !!d.has_sa_license,
      is_first_time: !!d.is_first_time,
      driving_test_status: d.is_first_time ? "pending" : "not_required",
      licence_expiry_snapshot: null as string | null,
      licence_number_snapshot: null as string | null,
    }))
    .filter((d) => d.name);

  // Every booking needs at least one driver (each needs a licence + passport
  // photo — Hub users' from their profile, checked below; outsiders' are
  // uploaded right after create and checked again at approval).
  if (drivers.length === 0) {
    return NextResponse.json({ error: "Add at least one driver" }, { status: 400 });
  }

  // Hard block, server side. The form runs the same check, but a client can
  // post whatever it likes — this is the one that decides. Licence facts come
  // from the database, never from the request body.
  //
  // Runs BEFORE the booking row is inserted so a rejected request leaves
  // nothing behind.
  const driverUserIds = drivers
    .map((d) => d.user_id)
    .filter((id): id is string => !!id);
  const pendingTestUserIds: string[] = [];
  if (driverUserIds.length > 0) {
    const facts = await getLicenceFactsFor(createAdminClient(), driverUserIds);
    for (const d of drivers) {
      if (!d.user_id) continue;
      const f = facts.get(d.user_id);
      if (!f) {
        return NextResponse.json(
          { error: `${d.name} is not an active Hub user.` },
          { status: 400 }
        );
      }
      const check = checkDriverEligibility(
        eligibilityInput(f),
        ret,
        "request"
      );
      if (!check.ok) {
        return NextResponse.json(
          {
            error: `${d.name} cannot be added as a driver — ${check.message}`,
            blockedDriver: d.user_id,
            reason: check.reason,
          },
          { status: 400 }
        );
      }
      // Freeze what was true today; a later renewal must not rewrite this
      // booking's record.
      d.licence_expiry_snapshot = f.expiry;
      d.licence_number_snapshot = f.number;
      // The person's recorded result wins — except that a requester flagging
      // a first-timer must be able to START the test process, which is the
      // one thing the profile's default "not_required" can't express.
      const promote = d.is_first_time && f.test === "not_required";
      d.driving_test_status = promote ? "pending" : f.test;
      d.is_first_time = d.driving_test_status === "pending";
      if (promote) pendingTestUserIds.push(d.user_id);
    }
  }
  await markDrivingTestPending(createAdminClient(), pendingTestUserIds);

  const { data: booking, error } = await insertVehicleBooking(supabase, {
    booking_name: bookingName,
    point_person: nn(body.point_person),
    purpose,
    purpose_note: purpose === "other" ? nn(body.purpose_note) : null,
    requester_name: requesterName,
    requester_email: nn(body.requester_email),
    requester_phone: nn(body.requester_phone),
    num_people:
      typeof body.num_people === "number" && body.num_people > 0
        ? body.num_people
        : null,
    checkout_date: checkout,
    return_date: ret,
    home_country: nn(body.home_country),
    status: "pending",
    source: "internal",
    notes: nn(body.notes),
    requested_by: user.id,
  });

  if (error || !booking) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create booking" },
      { status: 500 }
    );
  }

  if (requestedIds.length > 0) {
    await setBookingVehicles(supabase, booking.id, requestedIds);
  }

  // The created driver rows go back to the client so it can upload each
  // driver's licence against a real driver id in a follow-up request.
  let created: { id: string; name: string }[] = [];
  if (drivers.length > 0) {
    const { data } = await setBookingDrivers(supabase, booking.id, drivers);
    created = data.map((d) => ({ id: d.id, name: d.name }));
  }

  // Let the vehicle managers know something is waiting for a decision.
  await notifyVehicleManagers({
    event: "requested",
    bookingId: booking.id,
    bookingName: bookingName,
    requesterName: requesterName,
    checkoutDate: checkout,
    returnDate: ret,
  });

  // Confirm receipt to the person who booked (Slack DM + email).
  after(() => notifyVehicleRequester({ bookingId: booking.id, kind: "submitted" }).then(() => undefined));

  return NextResponse.json({ ok: true, bookingId: booking.id, drivers: created });
}
