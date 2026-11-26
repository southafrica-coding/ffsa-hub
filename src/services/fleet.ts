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
    .select("*, assignments:vehicle_booking_assignments(vehicle_id)")
    .in("status", ["approved", "completed"])
    .gte("return_date", since)
    .order("checkout_date", { ascending: true });
}

// ── Hidden ("deleted") records (359) ───────────────────────
// RLS already hides them from Hub users; this also leaves them out when an admin
// client reads (the 07:00 message, bookings' clash check). It filters on the row,
// not in SQL, so it works the same before 359 adds the column.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rows = { data: any[] | null; error: any };
const notHidden = async <T extends Rows>(q: PromiseLike<T>): Promise<T> => {
  const res = await q;
  return res.data ? { ...res, data: res.data.filter((r: any) => !r?.deleted_at) } : res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Workshop visits ────────────────────────────────────────

export async function getFleetVisits(
  supabase: Client,
  opts?: { vehicleId?: string; status?: "booked" | "done"; since?: string }
) {
  let query = supabase.from("fleet_workshop_visits").select("*").order("date", { ascending: false });
  if (opts?.vehicleId) query = query.eq("vehicle_id", opts.vehicleId);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.since) query = query.gte("date", opts.since);
  return notHidden(query);
}

export async function insertFleetVisit(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_workshop_visits").insert(row).select().single();
}

/** "Delete" a workshop visit: hidden, never erased (359; Gideon: all history kept). Read
 *  first, because once hidden the row can't be read back. `data` is null when not found. */
export async function deleteFleetVisit(supabase: Client, id: string) {
  const { data: row, error } = await supabase.from("fleet_workshop_visits").select("*").eq("id", id).maybeSingle();
  if (error || !row || row.deleted_at) return { data: null, error };
  const { error: upErr } = await hideFleetRow(supabase, "fleet_workshop_visits", id);
  return { data: upErr ? null : row, error: upErr };
}

/** Hide (never erase) a Fleet record; 359's fleet_hide_row records when and who. */
export async function hideFleetRow(supabase: Client, table: "fleet_inspections" | "fleet_workshop_visits" | "fleet_odometer_readings", id: string) {
  return supabase.rpc("fleet_hide_row", { p_table: table, p_id: id });
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
  return notHidden(query);
}

export async function getFleetInspection(supabase: Client, id: string) {
  const res = await supabase.from("fleet_inspections").select("*").eq("id", id).maybeSingle();
  return res.data?.deleted_at ? { ...res, data: null } : res;
}

export async function insertFleetInspection(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("fleet_inspections").insert(row).select().single();
}

/** "Delete" an inspection: hidden, never erased (359; Gideon: all history kept). */
export async function deleteFleetInspection(supabase: Client, id: string) {
  return hideFleetRow(supabase, "fleet_inspections", id);
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
  return notHidden(
    supabase
      .from("fleet_odometer_readings")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
  );
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

/** Who made a Hub booking (so a Move doesn't message someone about their own change). */
export async function getBookingRequestedBy(supabase: Client, bookingId: string) {
  return supabase.from("vehicle_bookings").select("requested_by").eq("id", bookingId).maybeSingle();
}

// ── Fixes (358: add-only) ──────────────────────────────────

export async function insertFleetFix(
  supabase: Client,
  row: { vehicle_id: string; item_id: string; point: string; fixed_on: string; fixed_by: string; work: string; was: Record<string, unknown>; recorded_by: string | null }
) {
  return supabase.from("fleet_fixes").insert(row).select("id").single();
}

/**
 * Mark as fixed in one transaction (410; Jack's review of #717): the fix row and the point's
 * new condition are written together by fleet_mark_fixed(), so neither can be left half-done.
 * Runs as the caller, so RLS applies to both writes. Returns the fix id.
 */
export async function markFleetFixed(
  supabase: Client,
  a: { vehicleId: string; itemId: string; point: string; fixedOn: string; by: string; work: string; was: Record<string, unknown>; entry: Record<string, unknown> }
) {
  return supabase.rpc("fleet_mark_fixed", {
    p_vehicle_id: a.vehicleId,
    p_item_id: a.itemId,
    p_point: a.point,
    p_fixed_on: a.fixedOn,
    p_fixed_by: a.by,
    p_work: a.work,
    p_was: a.was,
    p_entry: a.entry,
  });
}

/** Before 410 is applied the function doesn't exist yet. */
export const isMissingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /fleet_mark_fixed/.test(e.message || "") && /not find|does not exist/.test(e.message || ""));

/**
 * Undo a fix row whose Mark as fixed didn't finish (the condition write failed after the
 * insert; Jack's review of #703), so History never shows a fix the vehicle doesn't have.
 * Users can't delete fixes (358 grants them SELECT and INSERT only): pass the admin client.
 */
export async function removeUnfinishedFleetFix(admin: Client, fixId: string) {
  return admin.from("fleet_fixes").delete().eq("id", fixId);
}

/** A vehicle's fixes, newest first, optionally between two dates (inclusive). */
export async function getFleetFixes(supabase: Client, vehicleId: string, opts?: { from?: string; to?: string }) {
  let q = supabase.from("fleet_fixes").select("*").eq("vehicle_id", vehicleId).order("fixed_on", { ascending: false });
  if (opts?.from) q = q.gte("fixed_on", opts.from);
  if (opts?.to) q = q.lte("fixed_on", opts.to);
  return q;
}

/** Fleet 5c: put a booking on hold (its vehicle is out of action and nothing similar is
 *  free), or take it off hold. Needs 357. */
export async function setBookingHold(supabase: Client, bookingId: string, hold: { since: string; reason: string } | null) {
  return supabase
    .from("vehicle_bookings")
    .update(hold ? { on_hold_since: hold.since, on_hold_reason: hold.reason } : { on_hold_since: null, on_hold_reason: null })
    .eq("id", bookingId)
    .select("id")
    .maybeSingle();
}

/** Fleet 5c: cancel a booking because its vehicle broke down. */
export async function cancelBookingBrokenDown(supabase: Client, bookingId: string, note: string) {
  return supabase
    .from("vehicle_bookings")
    .update({ status: "cancelled", decision_note: note, on_hold_since: null, on_hold_reason: null })
    .eq("id", bookingId)
    .in("status", ["pending", "approved"])
    .select("id")
    .maybeSingle();
}

// ── Daily reminder log ─────────────────────────────────────

export async function getFleetReminderSends(supabase: Client, limit = 7) {
  return supabase.from("fleet_reminder_sends").select("date, subject, recipients, sent_at").order("date", { ascending: false }).limit(limit);
}
