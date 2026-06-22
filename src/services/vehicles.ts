// Rent a Vehicle — data access. New tables (vehicles / vehicle_bookings /
// vehicle_booking_assignments / vehicle_booking_drivers) aren't in the
// generated database.ts yet, so this service uses the project's standard
// `Client = any` pattern and hand-written row types (mirrors services/bookings.ts).

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
  notes: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VehicleDriver = {
  id: string;
  vehicle_booking_id: string;
  name: string;
  phone: string | null;
  has_sa_license: boolean;
  is_first_time: boolean;
  driving_test_status: "not_required" | "pending" | "passed" | "failed";
  license_file_url: string | null;
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

/**
 * Vehicle assignments that overlap a [from, to] window on still-live bookings
 * (pending or approved), optionally excluding one booking (when editing it).
 * Two-step to avoid embedded-filter pitfalls. Drives availability + clash math.
 */
export async function getOverlappingAssignments(
  supabase: Client,
  from: string,
  to: string,
  excludeBookingId?: string
): Promise<{ vehicle_id: string; vehicle_booking_id: string }[]> {
  const { data: bk } = await supabase
    .from("vehicle_bookings")
    .select("id")
    .in("status", ["pending", "approved"])
    .lte("checkout_date", to)
    .gte("return_date", from);

  let ids: string[] = (bk ?? []).map((b: { id: string }) => b.id);
  if (excludeBookingId) ids = ids.filter((id) => id !== excludeBookingId);
  if (ids.length === 0) return [];

  const { data: asg } = await supabase
    .from("vehicle_booking_assignments")
    .select("vehicle_id, vehicle_booking_id")
    .in("vehicle_booking_id", ids);

  return asg ?? [];
}

// ── Drivers ────────────────────────────────────────────────

export async function setBookingDrivers(
  supabase: Client,
  bookingId: string,
  drivers: Record<string, unknown>[]
) {
  await supabase
    .from("vehicle_booking_drivers")
    .delete()
    .eq("vehicle_booking_id", bookingId);
  if (drivers.length === 0) return { error: null };
  const rows = drivers.map((d) => ({ ...d, vehicle_booking_id: bookingId }));
  return supabase.from("vehicle_booking_drivers").insert(rows);
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

  const { data: permRows } = await supabase
    .from("user_permissions")
    .select("permissions!inner(key,module)")
    .eq("user_id", userId)
    .eq("permissions.module", "vehicles");

  const keys = new Set<string>();
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    if (perm?.key) keys.add(perm.key);
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

/** Inclusive day count between two ISO dates (collection → return). */
export function dayCount(checkout: string, ret: string): number {
  const a = new Date(checkout + "T00:00:00Z").getTime();
  const b = new Date(ret + "T00:00:00Z").getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

// ── Inspections (v2) ───────────────────────────────────────

export type InspectionKind = "collection" | "return";
export type InspectionFileKind = "damage_photo" | "license";

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
      "id, booking_name, requester_name, requester_email, total_amount, payment_received, requested_by, status"
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
