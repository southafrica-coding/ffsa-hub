/**
 * The Hub services the assistant's second slice uses: bookings, contacts,
 * forms, hire stock, and the read-only checks behind a problem report.
 *
 * Every function here is a thin wrapper over an existing Hub service or
 * access helper, with the service-role client (the bot has no session).
 * Who may call which is decided in the tools-*.ts modules from the
 * `*Access` readers below — the same helpers the Hub's own pages and
 * routes use, keyed by the asker's Hub user id. Kept in one module so the
 * tests can swap it wholesale (testing-hub.ts).
 */

import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import { hasAnyPermission, hasAnyRole } from "@/lib/api-auth";
import { userHasPassword } from "@/lib/auth/account-state";
import { loadStore } from "@/lib/equipment/storefront";
import { syncBookingAlerts } from "@/lib/prayer-room/booking-alerts";
import { notifyBookingDecision } from "@/lib/push/notify";
import {
  createVehicleRequest as createVehicleRequestRow,
  findVehicleClashes,
  prepareDrivers,
  type PreparedDriver,
  type RequestFields,
  type VehicleRequestBody,
} from "@/lib/vehicles/booking-request";
import { notifyVehicleRequester } from "@/lib/vehicles/requester-notify";
import { refreshVehicleRequestAlerts } from "@/lib/vehicles/slack-alerts";
import { getBookingAccess, getBookingById, getBookings, getPendingRequests, updateBooking } from "@/services/bookings";
import { getContactById, getContacts, updateContact } from "@/services/contacts";
import { listAllForms } from "@/services/forms";
import { getListOptions } from "@/services/list-options";
import { decideVehicleBooking } from "@/services/vehicle-decisions";
import {
  getBookingDrivers,
  getMyVehicleRequests,
  getPendingVehicleBookings,
  getVehicleAccess,
  getVehicleBookingById,
  getVehicleBookings,
  getVehiclePeople,
  getVehicles,
  type DayAvailability,
  type VehicleAccess,
  type VehiclePerson,
} from "@/services/vehicles";
import type { BookingAccess } from "@/services/bookings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type { BookingAccess, DayAvailability, PreparedDriver, RequestFields, VehicleAccess, VehiclePerson, VehicleRequestBody };

// ────────────────────────────────────────────────────────────
// Access — the Hub's own helpers, for the asker
// ────────────────────────────────────────────────────────────

/** Vehicles: the same getVehicleAccess the booking pages and routes use. */
export function vehicleAccess(admin: Client, userId: string): Promise<VehicleAccess> {
  return getVehicleAccess(admin, userId);
}

/** Space bookings: the same getBookingAccess the bookings pages and routes use. */
export function bookingAccess(admin: Client, userId: string): Promise<BookingAccess> {
  return getBookingAccess(admin, userId);
}

/**
 * May read contacts: the contacts SELECT policy (migration 087) — the
 * super_admin / admin / staff / events_admin roles, or contacts.view /
 * contacts.read (direct or through a role, as has_permission counts it).
 * Narrower than canViewContacts, which also lets comms_admin through
 * although RLS would show them nothing on the contact page.
 */
export async function contactsReadAccess(admin: Client, userId: string): Promise<boolean> {
  if (await hasAnyRole(admin, userId, ["super_admin", "admin", "staff", "events_admin"])) return true;
  return hasAnyPermission(admin, userId, ["contacts.view", "contacts.read"], { viaRoleBundle: true });
}

/**
 * May edit a contact's details: exactly the contact page's canEdit (which
 * shows the Edit dialog), itself the contacts UPDATE policy.
 */
export async function contactsEditAccess(admin: Client, userId: string): Promise<boolean> {
  if (await hasAnyRole(admin, userId, ["super_admin", "admin", "events_admin"])) return true;
  return hasAnyPermission(admin, userId, ["contacts.edit", "contacts.write"]);
}

/** Hub forms: canManageHubForms, the /forms page's gate. */
export function formsAccess(admin: Client, userId: string): Promise<boolean> {
  return canManageHubForms(admin, userId);
}

/**
 * May read the email log (email_messages SELECT policy, migration 314),
 * without the event-scoped branches: admins, events_admin, finance_admin,
 * or communications.view / contacts.view.
 */
export async function emailLogAccess(admin: Client, userId: string): Promise<boolean> {
  if (await hasAnyRole(admin, userId, ["super_admin", "admin", "events_admin", "finance_admin"])) return true;
  return hasAnyPermission(admin, userId, ["communications.view", "contacts.view"], { viaRoleBundle: true });
}

// ────────────────────────────────────────────────────────────
// Vehicles
// ────────────────────────────────────────────────────────────

export type VehicleLite = { id: string; name: string; vehicle_type: string; seats: number | null; make_model: string | null };

export async function listActiveVehicles(admin: Client): Promise<VehicleLite[]> {
  const { data } = await getVehicles(admin, { activeOnly: true });
  return ((data ?? []) as VehicleLite[]).map((v) => ({
    id: v.id,
    name: v.name,
    vehicle_type: v.vehicle_type,
    seats: v.seats,
    make_model: v.make_model,
  }));
}

/**
 * Free vans and cars per day, as the Vehicles calendar shows them.
 *
 * The calendar gets these from the vehicle_availability() SQL function
 * (migration 222), which is gated on has_vehicles_access() — auth.uid(),
 * so with the bot's service-role client it returns nothing. The caller
 * has already passed the same check in JS (vehicleAccess(...).canView,
 * in tools-hub.ts), so this counts the same rows directly instead, the
 * way that function does: the active fleet per type, less distinct active
 * vehicles on approved bookings covering the day (never below 0); pending
 * bookings are counted separately and not subtracted. Counts only — no
 * booking ids, names or people leave this function.
 */
export async function vehicleDayCounts(admin: Client, from: string, to: string): Promise<DayAvailability[]> {
  const [{ data: fleet }, { data: bookings }] = await Promise.all([
    admin.from("vehicles").select("id, vehicle_type").eq("status", "active"),
    admin
      .from("vehicle_bookings")
      .select("id, status, checkout_date, return_date")
      .in("status", ["pending", "approved"])
      .lte("checkout_date", to)
      .gte("return_date", from),
  ]);
  const live = (bookings ?? []) as DayCountBooking[];
  const { data: assignments } =
    live.length > 0
      ? await admin.from("vehicle_booking_assignments").select("vehicle_id, vehicle_booking_id").in("vehicle_booking_id", live.map((b) => b.id))
      : { data: [] };
  return countVehicleDays(from, to, (fleet ?? []) as DayCountVehicle[], live, (assignments ?? []) as DayCountAssignment[]);
}

type DayCountVehicle = { id: string; vehicle_type: string };
type DayCountBooking = { id: string; status: string; checkout_date: string; return_date: string };
type DayCountAssignment = { vehicle_id: string; vehicle_booking_id: string };

/** vehicle_availability()'s arithmetic, over rows already read. Days are inclusive ISO dates. */
export function countVehicleDays(
  from: string,
  to: string,
  fleet: DayCountVehicle[],
  bookings: DayCountBooking[],
  assignments: DayCountAssignment[]
): DayAvailability[] {
  const typeOf = new Map(fleet.map((v) => [v.id, v.vehicle_type]));
  const total = (t: string) => fleet.filter((v) => v.vehicle_type === t).length;
  const byBooking = new Map<string, string[]>();
  for (const a of assignments) byBooking.set(a.vehicle_booking_id, [...(byBooking.get(a.vehicle_booking_id) ?? []), a.vehicle_id]);

  const out: DayAvailability[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const used = { approved: { van: new Set<string>(), car: new Set<string>() }, pending: { van: new Set<string>(), car: new Set<string>() } };
    for (const b of bookings) {
      if (b.checkout_date > day || b.return_date < day) continue;
      if (b.status !== "approved" && b.status !== "pending") continue;
      for (const vid of byBooking.get(b.id) ?? []) {
        const type = typeOf.get(vid); // inactive vehicles aren't in the fleet, so don't count
        if (type === "van" || type === "car") used[b.status][type].add(vid);
      }
    }
    const vanTotal = total("van");
    const carTotal = total("car");
    out.push({
      day,
      vans: Math.max(0, vanTotal - used.approved.van.size),
      cars: Math.max(0, carTotal - used.approved.car.size),
      vanTotal,
      carTotal,
      vansRequested: used.pending.van.size,
      carsRequested: used.pending.car.size,
    });
  }
  return out;
}

/** Vehicle ids held over the window (ids only — nothing about who holds them). */
export async function heldVehicleIds(admin: Client, from: string, to: string): Promise<string[]> {
  return (await findVehicleClashes(admin, from, to, [])).unavailableIds;
}

export function vehiclePeople(admin: Client): Promise<VehiclePerson[]> {
  return getVehiclePeople(admin);
}

export function prepareVehicleDrivers(admin: Client, drivers: VehicleRequestBody["drivers"], ret: string) {
  return prepareDrivers(admin, drivers, ret);
}

export async function userDisplayName(admin: Client, userId: string): Promise<string | null> {
  const { data } = await admin.from("users").select("first_name, last_name").eq("id", userId).maybeSingle();
  const u = data as { first_name: string | null; last_name: string | null } | null;
  return u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || null : null;
}

/** Insert + notify the managers (shared with the Hub route), then the requester's "submitted" notice. */
export async function createVehicleRequest(
  admin: Client,
  args: Parameters<typeof createVehicleRequestRow>[2]
) {
  const created = await createVehicleRequestRow(admin, admin, args);
  if (created.ok) await notifyVehicleRequester({ bookingId: created.bookingId, kind: "submitted" });
  return created;
}

export type VehicleBookingLite = {
  id: string;
  booking_name: string;
  status: string;
  checkout_date: string;
  return_date: string;
  destination: string | null;
  requester_name: string | null;
  requested_by: string | null;
  decision_note: string | null;
  vehicles: string[];
};

type VehicleRow = VehicleBookingLite & { assignments?: { vehicle: { name: string } | null }[] | null };
const liteVehicle = (r: VehicleRow): VehicleBookingLite => ({
  id: r.id,
  booking_name: r.booking_name,
  status: r.status,
  checkout_date: r.checkout_date,
  return_date: r.return_date,
  destination: r.destination,
  requester_name: r.requester_name,
  requested_by: r.requested_by,
  decision_note: r.decision_note,
  vehicles: (r.assignments ?? []).map((a) => a.vehicle?.name).filter((n): n is string => Boolean(n)),
});

export async function myVehicleRequests(admin: Client, userId: string): Promise<VehicleBookingLite[]> {
  const { data } = await getMyVehicleRequests(admin, userId);
  return ((data ?? []) as VehicleRow[]).map(liteVehicle);
}

export async function vehicleBookingsBetween(admin: Client, from: string, to: string): Promise<VehicleBookingLite[]> {
  const { data } = await getVehicleBookings(admin, { from, to });
  return ((data ?? []) as VehicleRow[]).map(liteVehicle);
}

export async function pendingVehicleBookings(admin: Client): Promise<VehicleBookingLite[]> {
  const { data } = await getPendingVehicleBookings(admin);
  return ((data ?? []) as VehicleRow[]).map(liteVehicle);
}

export async function vehicleBooking(admin: Client, id: string): Promise<VehicleBookingLite | null> {
  const { data } = await getVehicleBookingById(admin, id);
  return data ? liteVehicle(data as VehicleRow) : null;
}

export type DriverLite = { name: string; user_id: string | null; has_licence_photo: boolean; has_passport_photo: boolean; driving_test_status: string };

export async function vehicleBookingDrivers(admin: Client, id: string): Promise<DriverLite[]> {
  const { data } = await getBookingDrivers(admin, id);
  return data.map((d) => ({
    name: d.name,
    user_id: d.user_id,
    has_licence_photo: Boolean(d.license_file_url),
    has_passport_photo: Boolean(d.passport_file_url),
    driving_test_status: d.driving_test_status,
  }));
}

/**
 * decideVehicleBooking (licence re-check, write, requester notice) — the
 * same function the Hub route and the Fleet Slack buttons call — then the
 * route's refreshVehicleRequestAlerts, so the co-ordinator's DM says it's
 * decided.
 */
export async function decideVehicle(admin: Client, userId: string, id: string, decision: "approved" | "denied", note: string | null) {
  const result = await decideVehicleBooking(admin, userId, id, decision, note);
  if (result.ok) await refreshVehicleRequestAlerts(id);
  return result;
}

// ────────────────────────────────────────────────────────────
// Space bookings
// ────────────────────────────────────────────────────────────

export type SpaceBookingLite = {
  id: string;
  title: string;
  status: string;
  booking_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  ministry: string | null;
  requester_name: string | null;
  requested_by: string | null;
  series_id: string | null;
  venue_id: string;
};

type SpaceRow = Omit<SpaceBookingLite, "venue" | "ministry"> & {
  venue?: { name: string } | null;
  ministry?: { name: string } | null;
};
const liteSpace = (r: SpaceRow): SpaceBookingLite => ({
  id: r.id,
  title: r.title,
  status: r.status,
  booking_date: r.booking_date,
  end_date: r.end_date,
  start_time: r.start_time,
  end_time: r.end_time,
  venue: r.venue?.name ?? null,
  ministry: r.ministry?.name ?? null,
  requester_name: r.requester_name,
  requested_by: r.requested_by,
  series_id: r.series_id,
  venue_id: r.venue_id,
});

export async function spaceBookingsBetween(admin: Client, from: string, to: string): Promise<SpaceBookingLite[]> {
  const { data } = await getBookings(admin, { from, to });
  return ((data ?? []) as SpaceRow[]).map(liteSpace);
}

export async function pendingSpaceBookings(admin: Client): Promise<SpaceBookingLite[]> {
  const { data } = await getPendingRequests(admin);
  return ((data ?? []) as SpaceRow[]).map(liteSpace);
}

export async function spaceBooking(admin: Client, id: string): Promise<SpaceBookingLite | null> {
  const { data } = await getBookingById(admin, id);
  return data ? liteSpace(data as SpaceRow) : null;
}

/**
 * The single-booking branch of POST /api/bookings/[id]/decision: the same
 * stamp through updateBooking, then the same syncBookingAlerts and
 * notifyBookingDecision. (Whole-series decisions stay in the Hub.)
 */
export async function decideSpace(
  admin: Client,
  userId: string,
  booking: SpaceBookingLite,
  decision: "approved" | "denied",
  note: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await updateBooking(admin, booking.id, {
    status: decision,
    decision_note: note,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  await syncBookingAlerts();
  await notifyBookingDecision({ booking, status: decision, deciderId: userId });
  return { ok: true };
}

// ────────────────────────────────────────────────────────────
// Contacts
// ────────────────────────────────────────────────────────────

export const CONTACT_FIELDS = [
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "gender",
  "marital_status",
  "nationality",
  "preferred_language",
  "preferred_channel",
  "address_line_1",
  "address_line_2",
  "city",
  "province",
  "postal_code",
  "country",
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export type ContactLite = { id: string; name: string; email: string | null; phone: string | null; status: string | null };
export type ContactDetail = ContactLite & Record<ContactField, string | null>;

type ContactRow = Record<string, string | null> & { id: string };
const contactName = (r: ContactRow) =>
  [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email || "Unnamed";

/** The contacts list's own search (names, email, phone), capped. */
export async function searchContacts(admin: Client, term: string, limit = 8): Promise<ContactLite[]> {
  const { data } = await getContacts(admin, { search: term, limit });
  return ((data ?? []) as ContactRow[]).map((r) => ({
    id: r.id,
    name: contactName(r),
    email: r.email ?? null,
    phone: r.phone ?? null,
    status: r.status ?? null,
  }));
}

export async function contactById(admin: Client, id: string): Promise<ContactDetail | null> {
  const { data } = await getContactById(admin, id);
  if (!data) return null;
  const r = data as ContactRow;
  const out: Record<string, string | null> = {};
  for (const f of CONTACT_FIELDS) out[f] = r[f] ?? null;
  return { id: r.id, name: contactName(r), email: r.email ?? null, phone: r.phone ?? null, status: r.status ?? null, ...out } as ContactDetail;
}

/** The gender choices the edit dialog offers (active list options). */
export async function genderOptions(admin: Client): Promise<string[]> {
  const { data } = await getListOptions(admin, "gender", { activeOnly: true });
  return ((data ?? []) as { value: string }[]).map((o) => o.value);
}

export function applyContactUpdate(admin: Client, id: string, patch: Partial<Record<ContactField, string | null>>) {
  // checkContactUpdate never clears first_name (the column is NOT NULL).
  return updateContact(admin, id, patch as Parameters<typeof updateContact>[2]);
}

// ────────────────────────────────────────────────────────────
// Forms and hire stock
// ────────────────────────────────────────────────────────────

export type FormLite = { id: string; name: string; slug: string; active: boolean; event: string | null; submissions: number; updated_at: string };

export async function listForms(admin: Client): Promise<FormLite[]> {
  const { data } = await listAllForms(admin);
  type Row = {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    updated_at: string;
    events: { title: string } | null;
    form_submissions: { count: number }[] | null;
  };
  return ((data ?? []) as Row[]).map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    active: f.is_active,
    event: f.events?.title ?? null,
    submissions: f.form_submissions?.[0]?.count ?? 0,
    updated_at: f.updated_at,
  }));
}

export type HireItem = { name: string; stock: number; free: number; price: string };

/** What the public /hire page shows for these dates (listed gear only). */
export async function hireStock(admin: Client, from: string, to: string): Promise<{ items: HireItem[]; error: string | null }> {
  const { items, error } = await loadStore(admin, { from, to });
  return {
    error,
    items: items.map((i) => ({ name: i.name, stock: i.stock, free: i.free, price: `R${(i.priceCents / 100).toFixed(2)} ${i.periodText}`.trim() })),
  };
}

// ────────────────────────────────────────────────────────────
// Read-only checks for problem reports
// ────────────────────────────────────────────────────────────

export type AccountState = { active: boolean; has_password: boolean; slack_linked: boolean };

export async function accountState(admin: Client, userId: string): Promise<AccountState | null> {
  const { data } = await admin.from("users").select("is_active, slack_user_id").eq("id", userId).maybeSingle();
  if (!data) return null;
  const u = data as { is_active: boolean | null; slack_user_id: string | null };
  return { active: u.is_active !== false, has_password: await userHasPassword(admin, userId), slack_linked: Boolean(u.slack_user_id) };
}

export type EmailLine = { category: string | null; status: string; at: string; failed: boolean };

/** The last few emails to an address from the email log (no subjects, no bodies). */
export async function recentEmailsTo(admin: Client, email: string, limit = 5): Promise<EmailLine[]> {
  const { data } = await admin
    .from("email_messages")
    .select("category, status, created_at")
    .ilike("to_email", email.replace(/[\\%_]/g, "\\$&"))
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { category: string | null; status: string; created_at: string }[]).map((m) => ({
    category: m.category,
    status: m.status,
    at: m.created_at,
    failed: ["bounced", "complained", "failed", "dropped"].includes(m.status),
  }));
}
