// A new vehicle booking request — the checks and the write, shared by
// POST /api/vehicles/bookings and the private "Hub" Slack assistant, so
// both refuse the same things with the same words.
//
// The route runs: validateVehicleRequestFields → findVehicleClashes (and
// stops there on a dry run) → prepareDrivers → createVehicleRequest. The
// caller checks getVehicleAccess first; nothing here decides who may book.

import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
import {
  eligibilityInput,
  getLicenceFactsFor,
  getOverlappingAssignments,
  insertVehicleBooking,
  markDrivingTestPending,
  setBookingDrivers,
  setBookingVehicles,
} from "@/services/vehicles";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type VehicleDriverInput = {
  user_id?: string | null;
  name?: string;
  phone?: string;
  has_sa_license?: boolean;
  is_first_time?: boolean;
};

export type VehicleRequestBody = {
  dryRun?: boolean;
  booking_name?: string;
  point_person?: string;
  destination?: string;
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
  drivers?: VehicleDriverInput[];
  notes?: string;
};

export const VEHICLE_PURPOSES = [
  "international_team",
  "ministry",
  "airport_run",
  "personal",
  "other",
];

export type RequestRefusal = {
  ok: false;
  status: number;
  error: string;
  clashingVehicleIds?: string[];
  blocked?: boolean;
  blockedDriver?: string;
  reason?: string;
};

export function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

// ── Fields ─────────────────────────────────────────────────

export type RequestFields = {
  bookingName: string;
  checkout: string;
  ret: string;
  purpose: string;
};

/** The required fields, in the order the form asks for them. */
export function validateVehicleRequestFields(
  body: VehicleRequestBody
): ({ ok: true } & RequestFields) | RequestRefusal {
  const bookingName = nn(body.booking_name);
  const checkout = nn(body.checkout_date);
  const ret = nn(body.return_date);
  const purpose = VEHICLE_PURPOSES.includes(body.purpose ?? "") ? body.purpose! : "ministry";

  if (!bookingName) return { ok: false, status: 400, error: "A booking name is required" };
  if (!nn(body.destination)) return { ok: false, status: 400, error: "A destination is required" };
  if (!nn(body.point_person)) return { ok: false, status: 400, error: "A point person is required" };
  if (!checkout || !ret) {
    return { ok: false, status: 400, error: "Collection and return dates are required" };
  }
  if (ret < checkout) {
    return { ok: false, status: 400, error: "The return date must be on or after the collection date" };
  }
  return { ok: true, bookingName, checkout, ret, purpose };
}

// ── Clashes ────────────────────────────────────────────────

export type Clashes = {
  unavailableIds: string[];
  requestedIds: string[];
  clashing: string[];
};

/**
 * Which vehicles are held over the window, and which of the requested ones
 * that makes impossible. `admin` must be an admin client (see
 * getOverlappingAssignments).
 */
export async function findVehicleClashes(
  admin: Client,
  checkout: string,
  ret: string,
  vehicleIds: unknown
): Promise<Clashes> {
  const overlapping = await getOverlappingAssignments(admin, checkout, ret);
  const unavailableIds = Array.from(new Set(overlapping.map((a) => a.vehicle_id)));
  const requestedIds = Array.isArray(vehicleIds)
    ? vehicleIds.filter((v): v is string => typeof v === "string")
    : [];
  // Hard block: a specific vehicle cannot be assigned to two overlapping bookings.
  const clashing = requestedIds.filter((id) => unavailableIds.includes(id));
  return { unavailableIds, requestedIds, clashing };
}

export const CLASH_ERROR =
  "One or more of the chosen vehicles is already booked, or in the workshop, for those dates. Pick different vehicles or adjust the dates.";

// ── Drivers ────────────────────────────────────────────────

export type PreparedDriver = {
  user_id: string | null;
  name: string | null;
  phone: string | null;
  has_sa_license: boolean;
  is_first_time: boolean;
  driving_test_status: string;
  licence_expiry_snapshot: string | null;
  licence_number_snapshot: string | null;
};

/**
 * Normalise the drivers and run the licence rules against the database.
 * Licence facts come from the users table, never from the request.
 */
export async function prepareDrivers(
  admin: Client,
  input: VehicleDriverInput[] | undefined,
  ret: string
): Promise<{ ok: true; drivers: PreparedDriver[]; pendingTestUserIds: string[] } | RequestRefusal> {
  const drivers: PreparedDriver[] = (input ?? [])
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
  if (drivers.length === 0) return { ok: false, status: 400, error: "Add at least one driver" };

  const driverUserIds = drivers.map((d) => d.user_id).filter((id): id is string => !!id);
  const pendingTestUserIds: string[] = [];
  if (driverUserIds.length > 0) {
    const facts = await getLicenceFactsFor(admin, driverUserIds);
    for (const d of drivers) {
      if (!d.user_id) continue;
      const f = facts.get(d.user_id);
      if (!f) return { ok: false, status: 400, error: `${d.name} is not an active Hub user.` };
      const check = checkDriverEligibility(eligibilityInput(f), ret, "request");
      if (!check.ok) {
        return {
          ok: false,
          status: 400,
          error: `${d.name} cannot be added as a driver — ${check.message}`,
          blockedDriver: d.user_id,
          reason: check.reason,
        };
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
  return { ok: true, drivers, pendingTestUserIds };
}

// ── The write ──────────────────────────────────────────────

/**
 * Insert the booking (status pending), its vehicles and drivers, then tell
 * the vehicle managers. `writer` does the inserts: the session client in
 * the Hub (so RLS applies), the admin client from Slack (where the caller
 * was checked up front). The requester's own "submitted" notice is left to
 * the caller, which decides when it runs.
 */
export async function createVehicleRequest(
  writer: Client,
  admin: Client,
  args: {
    userId: string;
    body: VehicleRequestBody;
    fields: RequestFields;
    requesterName: string | null;
    requestedIds: string[];
    drivers: PreparedDriver[];
    pendingTestUserIds: string[];
  }
): Promise<{ ok: true; bookingId: string; drivers: { id: string; name: string }[] } | RequestRefusal> {
  const { body, fields } = args;
  await markDrivingTestPending(admin, args.pendingTestUserIds);

  const { data: booking, error } = await insertVehicleBooking(writer, {
    booking_name: fields.bookingName,
    point_person: nn(body.point_person),
    destination: nn(body.destination),
    purpose: fields.purpose,
    purpose_note: fields.purpose === "other" ? nn(body.purpose_note) : null,
    requester_name: args.requesterName,
    requester_email: nn(body.requester_email),
    requester_phone: nn(body.requester_phone),
    num_people: typeof body.num_people === "number" && body.num_people > 0 ? body.num_people : null,
    checkout_date: fields.checkout,
    return_date: fields.ret,
    home_country: nn(body.home_country),
    status: "pending",
    source: "internal",
    notes: nn(body.notes),
    requested_by: args.userId,
  });
  if (error || !booking) {
    return { ok: false, status: 500, error: error?.message ?? "Failed to create booking" };
  }

  if (args.requestedIds.length > 0) {
    await setBookingVehicles(writer, booking.id, args.requestedIds);
  }

  // The created driver rows go back to the client so it can upload each
  // driver's licence against a real driver id in a follow-up request.
  let created: { id: string; name: string }[] = [];
  if (args.drivers.length > 0) {
    const { data } = await setBookingDrivers(writer, booking.id, args.drivers);
    created = data.map((d) => ({ id: d.id, name: d.name }));
  }

  // Let the vehicle managers know something is waiting for a decision.
  await notifyVehicleManagers({
    event: "requested",
    bookingId: booking.id,
    bookingName: fields.bookingName,
    requesterName: args.requesterName,
    checkoutDate: fields.checkout,
    returnDate: fields.ret,
  });

  return { ok: true, bookingId: booking.id, drivers: created };
}
