// Rent a Vehicle — data access. New tables (vehicles / vehicle_bookings /
// vehicle_booking_assignments / vehicle_booking_drivers) aren't in the
// generated database.ts yet, so this service uses the project's standard
// `Client = any` pattern and hand-written row types (mirrors services/bookings.ts).

import { blocksWindow, holdLookback, HOLD_STATUSES, type HoldFields } from "@/lib/vehicles/hold";
import { getRoleDerivedPermissionRows } from "@/services/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type VehicleStatusValue =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "completed";

export type VehiclePurpose =
  | "international_team"
  | "ministry"
  | "airport_run"
  | "personal"
  | "other";

export type Vehicle = {
  id: string;
  name: string;
  vehicle_type: "van" | "car";
  make_model: string | null;
  fuel_type: "diesel" | "petrol" | null;
  seats: number | null;
  registration_plate: string | null;
  status: "active" | "maintenance" | "retired";
  color: string;
  notes: string | null;
  xero_item_code: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VehicleBooking = {
  id: string;
  booking_name: string;
  point_person: string | null;
  /** Where they plan to drive (migration 253). Required on new requests. */
  destination: string | null;
  purpose: VehiclePurpose;
  purpose_note: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  num_people: number | null;
  checkout_date: string;
  return_date: string;
  status: VehicleStatusValue;
  decision_note: string | null;
  pricing_per_day: number | null;
  currency: string;
  total_amount: number | null;
  payment_required: boolean;
  payment_received: boolean;
  payment_received_at: string | null;
  home_country: string | null;
  /** 'public' when the request came in through the shareable outside link. */
  source: "internal" | "public";
  notes: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  /** 365: the International Team hold (lib/vehicles/hold.ts), released by the coordinator. */
  hold_released_at?: string | null;
  hold_released_by?: string | null;
  hold_release_note?: string | null;
};

export type VehicleDriver = {
  id: string;
  vehicle_booking_id: string;
  /** The Hub user this driver is. NULL for outsiders and public requests. */
  user_id: string | null;
  licence_expiry_snapshot: string | null;
  licence_number_snapshot: string | null;
  name: string;
  phone: string | null;
  /** Optional (364): for the pick-up and return instructions. */
  email?: string | null;
  has_sa_license: boolean;
  is_first_time: boolean;
  driving_test_status: "not_required" | "pending" | "passed" | "failed";
  license_file_url: string | null;
  license_file_name: string | null;
  license_uploaded_at: string | null;
  license_uploaded_by: string | null;
  passport_file_url: string | null;
  passport_file_name: string | null;
  passport_uploaded_at: string | null;
  created_at: string;
};

export type AssignedVehicle = Pick<
  Vehicle,
  "id" | "name" | "vehicle_type" | "color" | "registration_plate"
>;

export type VehicleBookingWithRefs = VehicleBooking & {
  assignments?: { vehicle: AssignedVehicle | null }[] | null;
  drivers?: VehicleDriver[] | null;
};

export type VehicleAccess = {
  isAdmin: boolean;
  canView: boolean;
  canRequest: boolean;
  canApprove: boolean;
  canManage: boolean;
};

const ASSIGN_EMBED =
  "assignments:vehicle_booking_assignments(vehicle:vehicles(id,name,vehicle_type,color,registration_plate))";
const DRIVER_EMBED = "drivers:vehicle_booking_drivers(*)";

// ── Fleet ──────────────────────────────────────────────────

export async function getVehicles(
  supabase: Client,
  opts?: { activeOnly?: boolean }
) {
  let query = supabase
    .from("vehicles")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.activeOnly) query = query.eq("status", "active");
  return query;
}

export async function createVehicle(supabase: Client, data: Partial<Vehicle>) {
  return supabase.from("vehicles").insert(data).select().single();
}

export async function updateVehicle(
  supabase: Client,
  id: string,
  data: Partial<Vehicle>
) {
  return supabase
    .from("vehicles")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

// ── Availability ───────────────────────────────────────────

export type DayAvailability = {
  day: string;
  /** Free right now — total fleet less what approved bookings hold. */
  vans: number;
  cars: number;
  vanTotal: number;
  carTotal: number;
  /** Held by unapproved requests. Shown as a hint, never subtracted. */
  vansRequested: number;
  carsRequested: number;
};

type AvailabilityRow = {
  day: string;
  vehicle_type: "van" | "car";
  total: number;
  confirmed_used: number;
  pending_used: number;
};

/**
 * Per-day free-vehicle counts over an inclusive date range, keyed by ISO day.
 *
 * Goes through the `vehicle_availability` SQL function rather than reading
 * bookings, because a normal user can no longer see booking rows at all (see
 * migration 222) — and shouldn't: the calendar's whole point is that it gives
 * away counts and nothing else.
 */
export async function getVehicleAvailability(
  supabase: Client,
  from: string,
  to: string
): Promise<Map<string, DayAvailability>> {
  const { data } = await supabase.rpc("vehicle_availability", {
    p_from: from,
    p_to: to,
  });

  const byDay = new Map<string, DayAvailability>();
  for (const row of (data ?? []) as AvailabilityRow[]) {
    const entry =
      byDay.get(row.day) ??
      {
        day: row.day,
        vans: 0,
        cars: 0,
        vanTotal: 0,
        carTotal: 0,
        vansRequested: 0,
        carsRequested: 0,
      };

    // Clamp: a manager can assign a vehicle from the booking screen, which
    // doesn't run the request form's clash check, so used can in principle
    // exceed the active fleet. Never render a negative count.
    const free = Math.max(0, row.total - row.confirmed_used);
    if (row.vehicle_type === "van") {
      entry.vans = free;
      entry.vanTotal = row.total;
      entry.vansRequested = row.pending_used;
    } else {
      entry.cars = free;
      entry.carTotal = row.total;
      entry.carsRequested = row.pending_used;
    }
    byDay.set(row.day, entry);
  }
  return byDay;
}

// ── Bookings ───────────────────────────────────────────────

export async function getVehicleBookings(
  supabase: Client,
  opts?: { from?: string; to?: string; status?: string }
) {
  let query = supabase
    .from("vehicle_bookings")
    .select(`*, ${ASSIGN_EMBED}`)
    .order("checkout_date", { ascending: true });

  // Overlap with [from, to]: checkout_date <= to AND return_date >= from.
  if (opts?.to) query = query.lte("checkout_date", opts.to);
  if (opts?.from) query = query.gte("return_date", opts.from);
  if (opts?.status) query = query.eq("status", opts.status);

  return query;
}

export async function getVehicleBookingById(supabase: Client, id: string) {
  return supabase
    .from("vehicle_bookings")
    .select(`*, ${ASSIGN_EMBED}, ${DRIVER_EMBED}`)
    .eq("id", id)
    .single();
}

/** Lean owner/status lookup for authorization in API routes. */
export async function getVehicleBookingOwner(supabase: Client, id: string) {
  return supabase
    .from("vehicle_bookings")
    .select("requested_by, status")
    .eq("id", id)
    .single();
}

export async function countPendingVehicleBookings(
  supabase: Client
): Promise<number> {
  const { count } = await supabase
    .from("vehicle_bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

export async function getPendingVehicleBookings(supabase: Client) {
  return supabase
    .from("vehicle_bookings")
    .select(`*, ${ASSIGN_EMBED}`)
    .eq("status", "pending")
    .order("checkout_date", { ascending: true });
}

export async function getMyVehicleRequests(supabase: Client, userId: string) {
  return supabase
    .from("vehicle_bookings")
    .select(`*, ${ASSIGN_EMBED}`)
    .eq("requested_by", userId)
    .order("checkout_date", { ascending: false });
}

export async function insertVehicleBooking(
  supabase: Client,
  row: Record<string, unknown>
) {
  return supabase.from("vehicle_bookings").insert(row).select().single();
}

export async function updateVehicleBooking(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("vehicle_bookings")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteVehicleBooking(supabase: Client, id: string) {
  return supabase.from("vehicle_bookings").delete().eq("id", id);
}

// ── Assignments (booking ↔ vehicle) ────────────────────────

/** Replace a booking's assigned vehicles with the given set. */
export async function setBookingVehicles(
  supabase: Client,
  bookingId: string,
  vehicleIds: string[]
) {
  await supabase
    .from("vehicle_booking_assignments")
    .delete()
    .eq("vehicle_booking_id", bookingId);
  if (vehicleIds.length === 0) return { error: null };
  const rows = vehicleIds.map((vehicle_id) => ({
    vehicle_booking_id: bookingId,
    vehicle_id,
  }));
  return supabase.from("vehicle_booking_assignments").insert(rows);
}

export type WorkshopBlock = { id: string; vehicle_id: string; date: string; until: string | null; kind: string | null; provider: string | null };

/**
 * Booked Fleet workshop visits that overlap [from, to] (SPEC 7.3: a booked visit
 * blocks its vehicle from `date` to `until`). Needs an ADMIN client: the fleet_
 * tables are only readable to Fleet users.
 */
export async function getWorkshopBlocks(supabase: Client, from: string, to: string): Promise<WorkshopBlock[]> {
  const { data } = await supabase
    .from("fleet_workshop_visits")
    .select("*") // includes deleted_at once 359 is applied: a hidden visit blocks nothing
    .eq("status", "booked")
    .lte("date", to);
  return ((data ?? []) as (WorkshopBlock & { deleted_at?: string | null })[])
    .filter((v) => !v.deleted_at)
    .map(({ id, vehicle_id, date, until, kind, provider }): WorkshopBlock => ({ id, vehicle_id, date, until, kind, provider }))
    .filter((v) => v.date && (v.until && v.until >= v.date ? v.until : v.date) >= from);
}

/**
 * Vehicle assignments that overlap a [from, to] window on still-live bookings
 * (pending or approved), optionally excluding one booking (when editing it).
 * Two-step to avoid embedded-filter pitfalls. Drives availability + clash math.
 */
/**
 * Which vehicles are already held over [from, to] — by PENDING or APPROVED
 * bookings both, because a specific vehicle can't be promised twice.
 *
 * Must be given an ADMIN client. Since migration 222 a requester can only read
 * their own bookings, so a session client would report the fleet as wide open
 * and the clash check would wave through a double-booking. Only vehicle ids
 * leave this function, never anything about the booking holding them.
 */
export async function getOverlappingAssignments(
  supabase: Client,
  from: string,
  to: string,
  excludeBookingId?: string
): Promise<{ vehicle_id: string; vehicle_booking_id: string }[]> {
  // An International Team booking keeps its vehicles for 3 working days after the
  // due-back day (lib/vehicles/hold.ts), so look back far enough to catch its hold.
  // "*" rather than named columns: before migration 365 the hold columns don't exist,
  // and naming one would fail the query and wave every booking through.
  const { data: bk } = await supabase
    .from("vehicle_bookings")
    .select("*")
    .in("status", HOLD_STATUSES)
    .lte("checkout_date", to)
    .gte("return_date", holdLookback(from));

  let ids: string[] = ((bk ?? []) as (HoldFields & { id: string; status: string; checkout_date: string })[])
    .filter((b) => blocksWindow(b, from, to))
    .map((b) => b.id);
  if (excludeBookingId) ids = ids.filter((id) => id !== excludeBookingId);

  // Fleet (SPEC 7.3): a booked workshop visit blocks its vehicle from `date` to
  // `until`, so it counts as taken here too. Its id is "fleet-visit:<id>".
  const blocked = (await getWorkshopBlocks(supabase, from, to)).map((v) => ({
    vehicle_id: v.vehicle_id,
    vehicle_booking_id: `fleet-visit:${v.id}`,
  }));

  if (ids.length === 0) return blocked;

  const { data: asg } = await supabase
    .from("vehicle_booking_assignments")
    .select("vehicle_id, vehicle_booking_id")
    .in("vehicle_booking_id", ids);

  return [...(asg ?? []), ...blocked];
}

// ── Drivers ────────────────────────────────────────────────

/**
 * Reconcile a booking's drivers by id: rows carrying an `id` are updated in
 * place, rows without one are inserted, and stored rows missing from the
 * payload are deleted.
 *
 * This deliberately is NOT a delete-all-then-insert — driver rows own their
 * licence upload (license_file_url), so recreating them on every edit would
 * orphan the uploaded file and silently drop the licence from the booking.
 *
 * Returns the booking's drivers after the write, in creation order.
 */
export async function setBookingDrivers(
  supabase: Client,
  bookingId: string,
  drivers: (Record<string, unknown> & { id?: string | null })[]
): Promise<{ data: VehicleDriver[]; error: { message: string } | null }> {
  const { data: existing } = await supabase
    .from("vehicle_booking_drivers")
    .select("id")
    .eq("vehicle_booking_id", bookingId);
  const existingIds = new Set<string>((existing ?? []).map((r: { id: string }) => r.id));

  const keptIds = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  // Slot per submitted driver: a kept id, or null awaiting the inserted row.
  const slots: (string | null)[] = [];

  for (const d of drivers) {
    const { id: rawId, ...fields } = d;
    const id = typeof rawId === "string" ? rawId : null;
    if (id && existingIds.has(id)) {
      keptIds.add(id);
      // driving_test_status is only derived on insert — a recorded
      // passed/failed result must survive later edits to the driver.
      delete fields.driving_test_status;
      const { error } = await supabase
        .from("vehicle_booking_drivers")
        .update(fields)
        .eq("id", id)
        .eq("vehicle_booking_id", bookingId);
      if (error) return { data: [], error };
      slots.push(id);
    } else {
      inserts.push({ ...fields, vehicle_booking_id: bookingId });
      slots.push(null);
    }
  }

  const removed = [...existingIds].filter((id) => !keptIds.has(id));
  if (removed.length > 0) {
    const { error } = await supabase
      .from("vehicle_booking_drivers")
      .delete()
      .in("id", removed);
    if (error) return { data: [], error };
  }

  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("vehicle_booking_drivers")
      .insert(inserts)
      .select("*");
    if (error) return { data: [], error };
    // Postgres returns inserted rows in input order, so they refill the empty
    // slots in submission order — the caller pairs driver ids back to the rows
    // it sent (needed to upload each driver's licence after create).
    const fresh = (data ?? []) as VehicleDriver[];
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === null) slots[i] = fresh[n++]?.id ?? null;
    }
  }

  const { data: all, error } = await getBookingDrivers(supabase, bookingId);
  if (error) return { data: [], error };
  const byId = new Map(all.map((d) => [d.id, d]));
  // Return in submission order so index i is the caller's driver i.
  const ordered = slots
    .map((id) => (id ? byId.get(id) : undefined))
    .filter((d): d is VehicleDriver => !!d);
  return { data: ordered, error: null };
}

/** A booking's drivers in creation order. */
export async function getBookingDrivers(
  supabase: Client,
  bookingId: string
): Promise<{ data: VehicleDriver[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("vehicle_booking_drivers")
    .select("*")
    .eq("vehicle_booking_id", bookingId)
    .order("created_at", { ascending: true });
  return { data: (data ?? []) as VehicleDriver[], error };
}

/** Set or clear a driver's licence file reference. */
export async function setDriverLicense(
  supabase: Client,
  driverId: string,
  patch:
    | {
        license_file_url: string | null;
        license_file_name: string | null;
        license_uploaded_at: string | null;
        license_uploaded_by: string | null;
      }
    | {
        passport_file_url: string | null;
        passport_file_name: string | null;
        passport_uploaded_at: string | null;
      }
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from("vehicle_booking_drivers")
    .update(patch)
    .eq("id", driverId);
  return { error };
}

/** One driver plus the id/requester of the booking it belongs to (for authz). */
export async function getDriverWithBooking(supabase: Client, driverId: string) {
  return supabase
    .from("vehicle_booking_drivers")
    .select(
      "id, vehicle_booking_id, license_file_url, passport_file_url, booking:vehicle_bookings(id,status,requested_by)"
    )
    .eq("id", driverId)
    .maybeSingle();
}

// ── Access ─────────────────────────────────────────────────

/** Resolve the current user's vehicle capabilities for UI gating. */
export async function getVehicleAccess(
  supabase: Client,
  userId: string
): Promise<VehicleAccess> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if ((roleRows?.length ?? 0) > 0) {
    return {
      isAdmin: true,
      canView: true,
      canRequest: true,
      canApprove: true,
      canManage: true,
    };
  }

  // Direct grants and role-bundle grants are independent — read them together.
  const [{ data: permRows }, roleDerived] = await Promise.all([
    supabase
      .from("user_permissions")
      .select("permissions!inner(key,module)")
      .eq("user_id", userId)
      .eq("permissions.module", "vehicles"),
    getRoleDerivedPermissionRows(supabase, userId),
  ]);

  const keys = new Set<string>();
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    if (perm?.key) keys.add(perm.key);
  }

  // Also honor permissions granted via an assigned role's bundle — e.g. the
  // self_service floor grants vehicles.view + vehicles.request to every user.
  // Mirrors RLS's role-aware has_permission so UI gating matches actual access.
  for (const perm of roleDerived) {
    if (perm.module === "vehicles") keys.add(perm.key);
  }

  return {
    isAdmin: false,
    canView: keys.size > 0,
    canRequest: keys.has("vehicles.request"),
    canApprove: keys.has("vehicles.approve"),
    canManage: keys.has("vehicles.manage"),
  };
}

// ── Pure helpers ───────────────────────────────────────────

export const PURPOSE_OPTIONS: { value: VehiclePurpose; label: string }[] = [
  { value: "international_team", label: "International Team" },
  { value: "ministry", label: "Ministry related events" },
  { value: "airport_run", label: "Airport run" },
  { value: "personal", label: "Personal use" },
  { value: "other", label: "Other" },
];

export function purposeLabel(value: string): string {
  return PURPOSE_OPTIONS.find((p) => p.value === value)?.label ?? value;
}

/**
 * Days quoted and shown for a booking (Gideon, 24 Nov 2026: "The due back day should not
 * be quoted"): collection to the last day it's needed, i.e. return_date (the due-back
 * morning) not counted. Never less than 1.
 */
export function billableDays(checkout: string, ret: string): number {
  return Math.max(1, dayCount(checkout, ret) - 1);
}

/** Inclusive day count between two ISO dates (collection → return). */
export function dayCount(checkout: string, ret: string): number {
  const a = new Date(checkout + "T00:00:00Z").getTime();
  const b = new Date(ret + "T00:00:00Z").getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Email addresses of everyone who manages vehicle bookings — the people who
 * should hear about a new request, a completed sign-out/sign-in, or a
 * cancellation.
 *
 * Resolves `vehicles.approve` / `vehicles.manage` held directly (user_permissions)
 * OR through a role bundle (role_permissions → user_roles) — the reverse of the
 * per-user getVehicleAccess, so the two always agree on who counts.
 *
 * Deliberately NOT every admin: super_admins hold every permission by virtue of
 * being admin, and copying all of them on every vehicle event is noise. Someone
 * who should get these gets the vehicle_manager role.
 *
 * Takes an ADMIN client — it reads other users' rows, which RLS would hide.
 */
export async function getVehicleManagerEmails(admin: Client): Promise<string[]> {
  const ids = await getVehicleManagerUserIds(admin);
  if (ids.length === 0) return [];
  const { data: users } = await admin.from("users").select("email").in("id", ids);
  const emails = new Set<string>();
  for (const u of users ?? []) {
    const e = (u.email as string | null)?.trim();
    if (e) emails.add(e);
  }
  return Array.from(emails);
}

/** Ids of everyone holding vehicles.approve / vehicles.manage (direct or via a role). */
export async function getVehicleManagerUserIds(admin: Client): Promise<string[]> {
  const { data: perms } = await admin
    .from("permissions")
    .select("id")
    .eq("module", "vehicles")
    .in("key", ["vehicles.approve", "vehicles.manage"]);
  const permIds = (perms ?? []).map((p: { id: string }) => p.id);
  if (permIds.length === 0) return [];

  const userIds = new Set<string>();

  const { data: direct } = await admin
    .from("user_permissions")
    .select("user_id")
    .in("permission_id", permIds);
  for (const row of direct ?? []) userIds.add(row.user_id as string);

  const { data: rolePerms } = await admin
    .from("role_permissions")
    .select("role_id")
    .in("permission_id", permIds);
  const roleIds = Array.from(
    new Set((rolePerms ?? []).map((r: { role_id: string }) => r.role_id))
  );
  if (roleIds.length > 0) {
    const { data: holders } = await admin
      .from("user_roles")
      .select("user_id")
      .in("role_id", roleIds);
    for (const row of holders ?? []) userIds.add(row.user_id as string);
  }

  return Array.from(userIds);
}

export type VehicleActivity = {
  id: string;
  bookingId: string | null;
  kind: "collected" | "returned" | "cancelled";
  bookingName: string | null;
  at: string;
};

/**
 * Recent fleet movement for the manager dashboard — sign-outs, sign-ins and
 * cancellations, newest first. Takes an ADMIN client: it spans every booking,
 * not just the caller's own. Callers must gate on canApprove/canManage first.
 */
export async function getRecentVehicleActivity(
  admin: Client,
  sinceIso: string,
  limit = 6
): Promise<VehicleActivity[]> {
  const [inspections, cancelled] = await Promise.all([
    admin
      .from("vehicle_inspections")
      .select("id, kind, created_at, booking:vehicle_bookings(id, booking_name)")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit * 2),
    admin
      .from("vehicle_bookings")
      .select("id, booking_name, updated_at")
      .eq("status", "cancelled")
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(limit * 2),
  ]);

  const out: VehicleActivity[] = [];

  for (const row of inspections.data ?? []) {
    const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking;
    out.push({
      id: row.id,
      bookingId: booking?.id ?? null,
      kind: row.kind === "collection" ? "collected" : "returned",
      bookingName: booking?.booking_name ?? null,
      at: row.created_at,
    });
  }

  for (const row of cancelled.data ?? []) {
    out.push({
      id: `cancel-${row.id}`,
      bookingId: row.id,
      kind: "cancelled",
      bookingName: row.booking_name ?? null,
      at: row.updated_at,
    });
  }

  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out.slice(0, limit);
}

// ── Inspections (v2) ───────────────────────────────────────

export type InspectionKind = "collection" | "return";
export type InspectionFileKind =
  | "damage_photo"
  | "license"
  | "carwash_receipt"
  | "fuel_gauge";

export type VehicleInspection = {
  id: string;
  vehicle_booking_id: string;
  vehicle_id: string | null;
  kind: InspectionKind;
  driver_names: string | null;
  mileage: number | null;
  fuel_full: boolean | null;
  washed: boolean | null;
  damage_reported: boolean | null;
  damage_panels: string[];
  inventory: Record<string, boolean>;
  condition_notes: string | null;
  declaration_agreed: boolean;
  // Added in 197 to match the Google Forms this replaced.
  all_drivers_present: boolean | null;
  usage_purpose: string | null;
  sa_license_confirmed: boolean | null;
  checkin_date: string | null;
  communicated_truthfully: boolean | null;
  inspection_permission: boolean | null;
  performed_by: string | null;
  performed_at: string;
  created_at: string;
};

export type VehicleInspectionFile = {
  id: string;
  vehicle_booking_id: string;
  inspection_id: string | null;
  kind: InspectionFileKind;
  file_path: string;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
};

/** Walk-around panels from the "Sign Out" form — the vehicle damage map. */
export const DAMAGE_PANELS: { key: string; label: string }[] = [
  { key: "front_bumper", label: "Front bumper" },
  { key: "front", label: "Front (windscreen & wipers)" },
  { key: "bonnet", label: "Bonnet & function" },
  { key: "right_front_fender", label: "Right front fender" },
  { key: "right_front_door", label: "Right front door & window" },
  { key: "right_rear_door", label: "Right rear door & window" },
  { key: "right_rear_fender", label: "Right rear fender" },
  { key: "rear_bumper", label: "Rear bumper" },
  { key: "boot", label: "Boot lid & function" },
  { key: "rear", label: "Rear (windscreen)" },
  { key: "left_rear_fender", label: "Left rear fender" },
  { key: "left_rear_door", label: "Left rear door & window" },
  { key: "left_front_door", label: "Left front door & window" },
  { key: "left_front_fender", label: "Left front fender" },
  { key: "roof", label: "Roof" },
  { key: "tyres", label: "Tyres (tread & sidewalls, all 4)" },
  { key: "rims", label: "Wheel rims (all 4)" },
];

/** In-vehicle inventory check from the "Sign Out" form. */
export const INVENTORY_ITEMS: { key: string; label: string }[] = [
  { key: "car_jack", label: "Car jack" },
  { key: "wheel_spanner", label: "Wheel spanner" },
  { key: "emergency_triangle", label: "Emergency triangle" },
  { key: "vests", label: "Emergency vests (×2)" },
  { key: "spare_tyre", label: "Spare tyre (condition checked)" },
];

export async function getInspectionsForBooking(supabase: Client, bookingId: string) {
  return supabase
    .from("vehicle_inspections")
    .select("*")
    .eq("vehicle_booking_id", bookingId)
    .order("performed_at", { ascending: true });
}

export async function insertInspection(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("vehicle_inspections").insert(row).select().single();
}

/**
 * Does this booking already have an inspection of this kind?
 *
 * There is no unique constraint on (booking, kind), so a double-submit would
 * otherwise write two rows and the booking page — which reads the first match
 * per kind — would silently show whichever came back first.
 */
export async function hasInspection(
  supabase: Client,
  bookingId: string,
  kind: InspectionKind
): Promise<boolean> {
  const { data } = await supabase
    .from("vehicle_inspections")
    .select("id")
    .eq("vehicle_booking_id", bookingId)
    .eq("kind", kind)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function getInspectionFiles(supabase: Client, bookingId: string) {
  return supabase
    .from("vehicle_inspection_files")
    .select("*")
    .eq("vehicle_booking_id", bookingId)
    .order("created_at", { ascending: true });
}

export async function insertInspectionFile(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("vehicle_inspection_files").insert(row).select().single();
}

export async function deleteInspectionFile(supabase: Client, id: string) {
  return supabase.from("vehicle_inspection_files").delete().eq("id", id);
}

export function inspectionKindLabel(kind: string): string {
  return kind === "collection" ? "Collection (Sign Out)" : "Return (Sign In)";
}

// ── Payments (v3) ──────────────────────────────────────────

export type VehiclePaymentStatus =
  | "pending"
  | "paid"
  | "cancelled"
  | "failed"
  | "refunded";

export type VehiclePayment = {
  id: string;
  vehicle_booking_id: string;
  amount_cents: number;
  currency: string;
  fx_rate: number | null;
  usd_amount: number | null;
  status: VehiclePaymentStatus;
  payment_provider: string;
  provider_reference: string | null;
  provider_payment_id: string | null;
  description: string | null;
  xero_item_code: string | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  created_by: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function getVehiclePaymentsForBooking(
  supabase: Client,
  bookingId: string
) {
  return supabase
    .from("vehicle_payments")
    .select("*")
    .eq("vehicle_booking_id", bookingId)
    .order("created_at", { ascending: false });
}

export async function getVehiclePaymentById(supabase: Client, id: string) {
  return supabase.from("vehicle_payments").select("*").eq("id", id).single();
}

export async function insertVehiclePayment(
  supabase: Client,
  row: Record<string, unknown>
) {
  return supabase.from("vehicle_payments").insert(row).select().single();
}

export async function updateVehiclePayment(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("vehicle_payments")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

/** Rands (e.g. "1 250.00") from a ZAR-cents amount, for display. */
export function randsLabel(amountCents: number, currency = "ZAR"): string {
  return `${currency} ${(amountCents / 100).toFixed(2)}`;
}

/** Booking fields needed by the checkout + webhook routes (untyped table). */
export async function getVehicleBookingPaymentInfo(supabase: Client, id: string) {
  return supabase
    .from("vehicle_bookings")
    .select(
      "id, booking_name, requester_name, requester_email, total_amount, payment_received, requested_by, status, home_country"
    )
    .eq("id", id)
    .maybeSingle();
}

/** The Xero item code of the first vehicle assigned to a booking. */
export async function getFirstAssignedVehicleXeroCode(
  supabase: Client,
  bookingId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("vehicle_booking_assignments")
    .select("vehicle:vehicles(xero_item_code)")
    .eq("vehicle_booking_id", bookingId)
    .limit(1);
  const row = data?.[0]?.vehicle;
  const v = Array.isArray(row) ? row[0] : row;
  return v?.xero_item_code ?? null;
}

/** Idempotent pending → paid transition; returns the row only on first flip. */
export async function markVehiclePaymentPaidIfPending(
  supabase: Client,
  id: string,
  providerPaymentId: string | null
) {
  return supabase
    .from("vehicle_payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_payment_id: providerPaymentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
}

export async function markVehiclePaymentStatusIfPending(
  supabase: Client,
  id: string,
  status: string
) {
  return supabase
    .from("vehicle_payments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
}

/** Flip a booking's payment gate (called from the webhook after a paid charge). */
export async function markBookingPaid(supabase: Client, bookingId: string) {
  return supabase
    .from("vehicle_bookings")
    .update({
      payment_received: true,
      payment_received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
}

// ── Policy agreements / e-signature (v3) ───────────────────

export type VehicleAgreement = {
  id: string;
  vehicle_booking_id: string;
  signer_name: string;
  signer_email: string | null;
  typed_signature: string;
  policy_version: string;
  agreed: boolean;
  ip_address: string | null;
  signed_by: string | null;
  signed_at: string;
  created_at: string;
};

export async function getAgreementsForBooking(supabase: Client, bookingId: string) {
  return supabase
    .from("vehicle_agreements")
    .select("*")
    .eq("vehicle_booking_id", bookingId)
    .order("signed_at", { ascending: false });
}

export async function insertAgreement(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("vehicle_agreements").insert(row).select().single();
}

// ── People (renter + driver pickers) ───────────────────────

/**
 * A Hub user as the booking form's pickers see them.
 *
 * Deliberately narrow: enough to fill the form and judge eligibility, and
 * nothing more. The licence NUMBER and the storage path never leave the
 * server — the picker only needs to know whether a licence exists and when
 * it expires.
 */
export type VehiclePerson = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  licence_expiry_date: string | null;
  licence_file_url: string | null; // presence only — see toVehiclePerson
  passport_file_url: string | null; // presence only
  base_driving_test_status: "not_required" | "pending" | "passed" | "failed";
};

const PERSON_COLUMNS =
  "id, first_name, last_name, display_name, email, phone, nationality, country, is_active, " +
  "licence_expiry_date, licence_file_url, passport_file_url, base_driving_test_status";

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  country: string | null;
  licence_expiry_date: string | null;
  licence_file_url: string | null;
  passport_file_url: string | null;
  base_driving_test_status: string | null;
};

function toVehiclePerson(row: PersonRow): VehiclePerson {
  const name =
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    row.display_name ||
    row.email ||
    "Unnamed";
  return {
    id: row.id,
    name,
    email: row.email,
    phone: row.phone,
    country: row.country ?? row.nationality,
    licence_expiry_date: row.licence_expiry_date,
    // Collapsed to a boolean-ish marker: the caller must not learn the path.
    licence_file_url: row.licence_file_url ? "on-file" : null,
    passport_file_url: row.passport_file_url ? "on-file" : null,
    base_driving_test_status:
      (row.base_driving_test_status as VehiclePerson["base_driving_test_status"]) ??
      "not_required",
  };
}

/**
 * Active Hub users for the renter and driver pickers, alphabetical.
 *
 * Runs on the ADMIN client by design: RLS lets a non-admin read only their own
 * user row, so a plain client would return a one-person list. The calling
 * route is what enforces "you have vehicle permissions".
 */
export async function getVehiclePeople(admin: Client): Promise<VehiclePerson[]> {
  const { data } = await admin
    .from("users")
    .select(PERSON_COLUMNS)
    .eq("is_active", true)
    .order("first_name", { ascending: true });
  return ((data ?? []) as PersonRow[]).map(toVehiclePerson);
}

export type LicenceFacts = {
  expiry: string | null;
  hasFile: boolean;
  hasPassport: boolean;
  test: string;
  number: string | null;
};

/** The facts in the shape checkDriverEligibility takes. */
export function eligibilityInput(f: LicenceFacts) {
  return {
    licence_expiry_date: f.expiry,
    licence_file_url: f.hasFile ? "on-file" : null,
    passport_file_url: f.hasPassport ? "on-file" : null,
    base_driving_test_status: f.test as "not_required" | "pending" | "passed" | "failed",
  };
}

/**
 * The licence facts for specific users, straight from the source.
 *
 * The API re-reads these at submit and at approval rather than trusting what
 * the browser sent — a client can claim any expiry date it likes.
 */
export async function getLicenceFactsFor(
  admin: Client,
  userIds: string[]
): Promise<Map<string, LicenceFacts>> {
  const out = new Map<string, LicenceFacts>();
  if (userIds.length === 0) return out;
  const { data } = await admin
    .from("users")
    .select("id, licence_expiry_date, licence_file_url, passport_file_url, base_driving_test_status, drivers_licence_number")
    .in("id", userIds);
  for (const r of (data ?? []) as {
    id: string;
    licence_expiry_date: string | null;
    licence_file_url: string | null;
    passport_file_url: string | null;
    base_driving_test_status: string | null;
    drivers_licence_number: string | null;
  }[]) {
    out.set(r.id, {
      expiry: r.licence_expiry_date,
      hasFile: !!r.licence_file_url,
      hasPassport: !!r.passport_file_url,
      test: r.base_driving_test_status ?? "not_required",
      number: r.drivers_licence_number,
    });
  }
  return out;
}

/** One driver row, by id, for the driving-test endpoint. */
export async function getDriverForTest(
  admin: Client,
  driverId: string
): Promise<{ id: string; user_id: string | null; name: string } | null> {
  const { data } = await admin
    .from("vehicle_booking_drivers")
    .select("id, user_id, name")
    .eq("id", driverId)
    .maybeSingle();
  return (data as { id: string; user_id: string | null; name: string } | null) ?? null;
}

/** Record a driving-test result on the driver row itself. */
export async function setDriverTestStatus(
  admin: Client,
  driverId: string,
  status: string
): Promise<{ error: { message: string } | null }> {
  const { error } = await admin
    .from("vehicle_booking_drivers")
    .update({ driving_test_status: status })
    .eq("id", driverId);
  return { error };
}

// ── Public request link (outsiders) ────────────────────────

export type VehicleRequestLink = {
  id: string;
  token: string;
  is_active: boolean;
  created_at: string;
  rotated_at: string | null;
};

/**
 * The current public request link, creating one on first use.
 *
 * One standing token rather than a link per person: an admin should be able
 * to paste the same URL to whoever asks. Rotating it kills every copy at
 * once, which is the trade — see rotateVehicleRequestLink.
 */
export async function getOrCreateVehicleRequestLink(
  admin: Client,
  userId: string
): Promise<VehicleRequestLink | null> {
  const { data: existing } = await admin
    .from("vehicle_request_links")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as VehicleRequestLink;

  const { data } = await admin
    .from("vehicle_request_links")
    .insert({ token: newRequestToken(), created_by: userId })
    .select()
    .single();
  return (data as VehicleRequestLink) ?? null;
}

/** Retire the current link and mint a new one. Old URLs stop working at once. */
export async function rotateVehicleRequestLink(
  admin: Client,
  userId: string
): Promise<VehicleRequestLink | null> {
  await admin
    .from("vehicle_request_links")
    .update({ is_active: false, rotated_at: new Date().toISOString() })
    .eq("is_active", true);
  const { data } = await admin
    .from("vehicle_request_links")
    .insert({ token: newRequestToken(), created_by: userId })
    .select()
    .single();
  return (data as VehicleRequestLink) ?? null;
}

/** Is this token a live request link? Service-role only — never exposed to anon. */
export async function resolveVehicleRequestLink(
  admin: Client,
  token: string
): Promise<VehicleRequestLink | null> {
  if (!token || token.length < 16) return null;
  const { data } = await admin
    .from("vehicle_request_links")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  return (data as VehicleRequestLink) ?? null;
}

/** 32 bytes of URL-safe randomness — the only thing guarding the public form. */
function newRequestToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mark people as needing the base-vehicle driving test.
 *
 * Written to the PROFILE, not just the booking: a first-timer flagged on one
 * request is still a first-timer on the next one, and the whole point of
 * moving this onto the person was that it stops resetting.
 *
 * Only ever promotes from 'not_required' — it must never overwrite a
 * recorded pass or fail.
 */
export async function markDrivingTestPending(
  admin: Client,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  await admin
    .from("users")
    .update({ base_driving_test_status: "pending" })
    .in("id", userIds)
    .eq("base_driving_test_status", "not_required");
}
