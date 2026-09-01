import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getOverlappingAssignments,
  insertVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
} from "@/services/vehicles";

type DriverInput = {
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
  const overlapping = await getOverlappingAssignments(supabase, checkout, ret);
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

  const drivers = (body.drivers ?? [])
    .map((d) => ({
      name: nn(d.name),
      phone: nn(d.phone),
      has_sa_license: !!d.has_sa_license,
      is_first_time: !!d.is_first_time,
      driving_test_status: d.is_first_time ? "pending" : "not_required",
    }))
    .filter((d) => d.name);
  // The created driver rows go back to the client so it can upload each
  // driver's licence against a real driver id in a follow-up request.
  let created: { id: string; name: string }[] = [];
  if (drivers.length > 0) {
    const { data } = await setBookingDrivers(supabase, booking.id, drivers);
    created = data.map((d) => ({ id: d.id, name: d.name }));
  }

  return NextResponse.json({ ok: true, bookingId: booking.id, drivers: created });
}
