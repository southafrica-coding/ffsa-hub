// Fleet (vehicle inspections, km, workshop visits) — data access only.
// Tables: fleet_* (migrations 350–353) plus public.vehicles and the approved
// vehicle_bookings that act as trips. Rows are mapped onto the rule shapes in
// src/lib/fleet/mapping.ts; business logic lives in src/lib/fleet/.

import { getRoleDerivedPermissionRows } from "@/services/permissions";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Access ─────────────────────────────────────────────────

export interface FleetAccess {
  isAdmin: boolean;
  canView: boolean;
  canManage: boolean;
}

/** The current user's Fleet capabilities, for UI gating. RLS (manages_fleet /
 *  views_fleet) is the real gate; this mirrors it. */
export async function getFleetAccess(supabase: Client, userId: string): Promise<FleetAccess> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  if ((roleRows?.length ?? 0) > 0) return { isAdmin: true, canView: true, canManage: true };

  const [{ data: permRows }, roleDerived] = await Promise.all([
    supabase
      .from("user_permissions")
      .select("permissions!inner(key,module)")
      .eq("user_id", userId)
      .eq("permissions.module", "fleet"),
    getRoleDerivedPermissionRows(supabase, userId),
  ]);

  const keys = new Set<string>();
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
    if (perm?.key) keys.add(perm.key);
  }
  for (const perm of roleDerived) if (perm.module === "fleet") keys.add(perm.key);

  const canManage = keys.has("fleet.manage");
  return { isAdmin: false, canView: canManage || keys.has("fleet.view"), canManage };
}

// ── Vehicles ───────────────────────────────────────────────

export const FLEET_VEHICLE_SELECT =
  "id, name, make_model, fuel_type, seats, registration_plate, status, sort_order, details:fleet_vehicle_details(*)";

export async function getFleetVehicles(supabase: Client) {
  return supabase
    .from("vehicles")
    .select(FLEET_VEHICLE_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

export async function getFleetVehicle(supabase: Client, vehicleId: string) {
  return supabase.from("vehicles").select(FLEET_VEHICLE_SELECT).eq("id", vehicleId).maybeSingle();
}

/** Update a vehicle's Fleet details. `patch` is in column names (see mapping.ts). */
export async function updateFleetVehicleDetails(
  supabase: Client,
  vehicleId: string,
  patch: Record<string, unknown>
) {
  return supabase.from("fleet_vehicle_details").update(patch).eq("vehicle_id", vehicleId).select().single();
}

export async function upsertFleetVehicleDetails(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_vehicle_details").upsert(row, { onConflict: "vehicle_id" }).select().single();
}

// ── Trips (approved Hub vehicle bookings) ──────────────────

/** Bookings that take a vehicle away: approved or completed, ending on or after `since`. */
export async function getFleetTrips(supabase: Client, since: string) {
  return supabase
    .from("vehicle_bookings")
    .select("id, booking_name, purpose, checkout_date, return_date, status, assignments:vehicle_booking_assignments(vehicle_id)")
    .in("status", ["approved", "completed"])
    .gte("return_date", since)
    .order("checkout_date", { ascending: true });
}

// ── Workshop visits ────────────────────────────────────────

export async function getFleetVisits(
  supabase: Client,
  opts?: { vehicleId?: string; status?: "booked" | "done"; since?: string }
) {
  let query = supabase.from("fleet_workshop_visits").select("*").order("date", { ascending: false });
  if (opts?.vehicleId) query = query.eq("vehicle_id", opts.vehicleId);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.since) query = query.gte("date", opts.since);
  return query;
}

export async function insertFleetVisit(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_workshop_visits").insert(row).select().single();
}

export async function deleteFleetVisit(supabase: Client, id: string) {
  return supabase.from("fleet_workshop_visits").delete().eq("id", id).select("id, vehicle_id").maybeSingle();
}

export async function updateFleetVisit(supabase: Client, id: string, patch: Record<string, unknown>) {
  return supabase.from("fleet_workshop_visits").update(patch).eq("id", id).select().single();
}

// ── Inspections ────────────────────────────────────────────

export async function getFleetInspections(supabase: Client, opts?: { vehicleId?: string; limit?: number }) {
  let query = supabase
    .from("fleet_inspections")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (opts?.vehicleId) query = query.eq("vehicle_id", opts.vehicleId);
  if (opts?.limit) query = query.limit(opts.limit);
  return query;
}

export async function getFleetInspection(supabase: Client, id: string) {
  return supabase.from("fleet_inspections").select("*").eq("id", id).maybeSingle();
}

export async function insertFleetInspection(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_inspections").insert(row).select().single();
}

export async function deleteFleetInspection(supabase: Client, id: string) {
  return supabase.from("fleet_inspections").delete().eq("id", id);
}

// ── Drafts ─────────────────────────────────────────────────

export async function getFleetDraft(supabase: Client, userId: string, vehicleId: string) {
  return supabase
    .from("fleet_inspection_drafts")
    .select("data, updated_at")
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
}

export async function saveFleetDraft(supabase: Client, userId: string, vehicleId: string, data: unknown) {
  return supabase
    .from("fleet_inspection_drafts")
    .upsert({ user_id: userId, vehicle_id: vehicleId, data }, { onConflict: "user_id,vehicle_id" });
}

export async function deleteFleetDraft(supabase: Client, userId: string, vehicleId: string) {
  return supabase.from("fleet_inspection_drafts").delete().eq("user_id", userId).eq("vehicle_id", vehicleId);
}

// ── Odometer readings ──────────────────────────────────────

export async function getFleetOdometerReadings(supabase: Client, vehicleId: string) {
  return supabase
    .from("fleet_odometer_readings")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
}

export async function insertFleetOdometerReading(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_odometer_readings").insert(row).select().single();
}

// ── Time log ───────────────────────────────────────────────

export async function getFleetTimeLogs(supabase: Client, since: string) {
  return supabase.from("fleet_time_logs").select("*").gte("date", since).order("date", { ascending: true });
}

export async function insertFleetTimeLog(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_time_logs").insert(row);
}

// ── Workshops ──────────────────────────────────────────────

export async function getFleetProviders(supabase: Client) {
  return supabase.from("fleet_providers").select("*").order("name", { ascending: true });
}

export async function upsertFleetProvider(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_providers").upsert(row).select().single();
}

// ── Settings ───────────────────────────────────────────────

export async function getFleetSettings(supabase: Client) {
  return supabase.from("fleet_settings").select("*").eq("id", "global").maybeSingle();
}

export async function updateFleetSettings(supabase: Client, patch: Record<string, unknown>) {
  return supabase.from("fleet_settings").update(patch).eq("id", "global").select().single();
}

// ── Files ──────────────────────────────────────────────────

export async function getFleetFile(supabase: Client, id: string) {
  return supabase.from("fleet_files").select("*").eq("id", id).maybeSingle();
}

export async function insertFleetFile(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_files").insert(row).select().single();
}

// ── Tutorial progress ──────────────────────────────────────

export async function getFleetGuideProgress(supabase: Client, userId: string) {
  return supabase.from("fleet_guide_progress").select("step, done_at").eq("user_id", userId);
}

// ── Vehicle Coordinator (role holder) ──────────────────────

/** Whoever holds the vehicle_coordinator role: name, phone, email, Slack id.
 *  Call with the service-role client (people/users rows are not readable by
 *  every co-ordinator under RLS); project the result before it reaches a page. */
export async function getFleetCoordinators(admin: Client) {
  return admin
    .from("user_roles")
    .select(
      "user_id, roles!inner(name), user:users!inner(id, display_name, email, is_active, slack_user_id, person:people(first_name, last_name, preferred_name, phone))"
    )
    .eq("roles.name", "vehicle_coordinator");
}

/** Delete a workshop. Past visits keep the name (fleet_workshop_visits.provider is text;
 *  provider_id is ON DELETE SET NULL). */
export async function deleteFleetProvider(supabase: Client, id: string) {
  return supabase.from("fleet_providers").delete().eq("id", id);
}

// ── Trips (moving a booking to another vehicle) ────────────

/** Move one vehicle assignment of a Hub booking to another vehicle (the Calendar's
 *  "Move … to …"). Returns the updated assignment, or null when it wasn't on `fromVehicleId`. */
export async function moveBookingAssignment(supabase: Client, bookingId: string, fromVehicleId: string, toVehicleId: string) {
  return supabase
    .from("vehicle_booking_assignments")
    .update({ vehicle_id: toVehicleId })
    .eq("vehicle_booking_id", bookingId)
    .eq("vehicle_id", fromVehicleId)
    .select("vehicle_booking_id, vehicle_id")
    .maybeSingle();
}

// ── Daily reminder log ─────────────────────────────────────

export async function getFleetReminderSends(supabase: Client, limit = 7) {
  return supabase.from("fleet_reminder_sends").select("date, subject, recipients, sent_at").order("date", { ascending: false }).limit(limit);
}
