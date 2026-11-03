// Pure bookings logic: no React, no network, so all of it is unit-tested.
// Wording and rules mirror the website (src/lib/bookings/*, src/services/
// vehicles.ts, src/lib/vehicles/licence.ts). Where the app only HINTS (the
// licence check, the availability greying), the server repeats the check
// and its answer is the one that counts.

import type { Person, SpaceBooking, SpaceStatus, VehicleBooking, VehicleStatus } from "./types";

// ── Dates ───────────────────────────────────────────────────────────────────

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Today on this phone, as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isoFromDate(d: Date): string {
  return todayISO(d);
}

export function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function hmFromDate(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "09:00:00" or "9:00" → "09:00"; anything else → null. */
export function hm(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${pad(parseInt(m[1], 10))}:${m[2]}` : null;
}

export function minutes(time: string | null | undefined): number | null {
  const t = hm(time);
  if (!t) return null;
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return `${d} ${MON[(m ?? 1) - 1]} ${y}`;
}

/** "Tue 3 Nov 2026" */
export function humanDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  return `${WD[dt.getUTCDay()]} ${shortDate(iso)}`;
}

/** "3 Nov 2026" or "3 Nov 2026 – 5 Nov 2026" (the web's dateRangeLabel). */
export function dateRangeLabel(start: string, end: string | null): string {
  if (!end || end === start) return shortDate(start);
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** "18:00 – 21:00", one side, or "All day" (the web shows "—"). */
export function timeRangeLabel(start: string | null, end: string | null): string {
  const s = hm(start);
  const e = hm(end);
  if (s && e) return `${s} – ${e}`;
  return s ?? e ?? "All day";
}

/** Inclusive day count (the web's dayCount). */
export function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 1;
  return Math.round((b - a) / 86_400_000) + 1;
}

// ── Status: always words + an icon, never colour alone ──────────────────────

export type AnyStatus = SpaceStatus | VehicleStatus;
export type StatusIcon = "clock" | "check" | "x" | "ban" | "flag";
export type StatusTone = "attention" | "positive" | "danger" | "secondary";

export function statusInfo(status: AnyStatus): { label: string; icon: StatusIcon; tone: StatusTone } {
  switch (status) {
    case "pending":
      return { label: "Waiting for approval", icon: "clock", tone: "attention" };
    case "approved":
      return { label: "Approved", icon: "check", tone: "positive" };
    case "denied":
      return { label: "Declined", icon: "x", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", icon: "ban", tone: "secondary" };
    case "completed":
      return { label: "Completed", icon: "flag", tone: "secondary" };
  }
}

// ── My bookings: one list across spaces and vehicles ───────────────────────

export type BookingItem = {
  kind: "space" | "vehicle";
  id: string;
  title: string;
  /** Venue name, or the vehicles assigned ("Vehicle not assigned yet"). */
  place: string;
  status: AnyStatus;
  start: string;
  end: string;
  /** "18:00 – 21:00" for spaces; "3 days" for vehicles. */
  when: string;
  repeats: boolean;
};

export function spaceItem(b: SpaceBooking): BookingItem {
  return {
    kind: "space",
    id: b.id,
    title: b.title,
    place: b.venue?.name ?? "Space",
    status: b.status,
    start: b.booking_date,
    end: b.end_date ?? b.booking_date,
    when: timeRangeLabel(b.start_time, b.end_time),
    repeats: !!b.series_id,
  };
}

export function vehicleNames(b: VehicleBooking): string {
  const names = b.assignments.map((a) => a.vehicle?.name).filter((n): n is string => !!n);
  return names.length ? names.join(", ") : "Vehicle not assigned yet";
}

export function vehicleItem(b: VehicleBooking): BookingItem {
  const days = dayCount(b.checkout_date, b.return_date);
  return {
    kind: "vehicle",
    id: b.id,
    title: b.booking_name,
    place: vehicleNames(b),
    status: b.status,
    start: b.checkout_date,
    end: b.return_date,
    when: days === 1 ? "1 day" : `${days} days`,
    repeats: false,
  };
}

export type Grouped = { upcoming: BookingItem[]; waiting: BookingItem[]; past: BookingItem[] };

/**
 * Waiting for approval: still pending and not over yet. Upcoming: approved
 * and not over yet. Past: everything finished, cancelled, declined or
 * completed. Live groups are soonest first; past is most recent first.
 */
export function groupBookings(items: BookingItem[], today: string): Grouped {
  const upcoming: BookingItem[] = [];
  const waiting: BookingItem[] = [];
  const past: BookingItem[] = [];
  for (const i of items) {
    const over = i.end < today;
    if (!over && i.status === "pending") waiting.push(i);
    else if (!over && i.status === "approved") upcoming.push(i);
    else past.push(i);
  }
  const soonest = (a: BookingItem, b: BookingItem) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title);
  upcoming.sort(soonest);
  waiting.sort(soonest);
  past.sort((a, b) => b.start.localeCompare(a.start));
  return { upcoming, waiting, past };
}

/** The web's cancel rule: only live bookings, by the requester or a manager. */
export function canCancel(status: AnyStatus, isOwner: boolean, isManager: boolean): boolean {
  return (status === "pending" || status === "approved") && (isOwner || isManager);
}

// ── New space request: validation (the web form's checks and wording) ──────

export type SpaceForm = {
  venueId: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  setupTime: string;
  setdownTime: string;
  title: string;
  description: string;
  pointPerson: string;
  requesterName: string;
  ministryId: string;
};

export const EMPTY_SPACE: SpaceForm = {
  venueId: "",
  date: "",
  endDate: "",
  startTime: "",
  endTime: "",
  setupTime: "",
  setdownTime: "",
  title: "",
  description: "",
  pointPerson: "",
  requesterName: "",
  ministryId: "",
};

/**
 * The time rules. The website only checks the dates; the app also stops an
 * end time at or before the start (a booking can't end before it begins)
 * and a set-up after the start or set-down before the end, because a phone
 * time wheel makes those slips easy. Multi-day bookings take the whole day,
 * so their times aren't compared.
 */
export function timeRangeError(f: Pick<SpaceForm, "date" | "endDate" | "startTime" | "endTime" | "setupTime" | "setdownTime">): string | null {
  const multiDay = !!f.endDate && f.endDate > f.date;
  if (multiDay) return null;
  const s = minutes(f.startTime);
  const e = minutes(f.endTime);
  const su = minutes(f.setupTime);
  const sd = minutes(f.setdownTime);
  if (s != null && e != null && e <= s) return "The end time must be after the start time.";
  if (su != null && s != null && su > s) return "Set-up must start at or before the event starts.";
  if (sd != null && e != null && sd < e) return "Set-down must finish at or after the event ends.";
  return null;
}

export function spaceWhenError(f: SpaceForm): string | null {
  if (!f.date) return "Please choose a date.";
  if (f.endDate && f.endDate < f.date) return "The end date must be on or after the start date.";
  return timeRangeError(f);
}

export function spaceDetailsError(f: SpaceForm): string | null {
  if (!f.title.trim()) return "Please enter an event name.";
  return null;
}

/** The body POST /api/bookings takes (one-off or multi-day; weekly runs stay on the web). */
export function spacePayload(f: SpaceForm, dryRun: boolean) {
  const t = (v: string) => v.trim() || null;
  return {
    dryRun,
    venue_id: f.venueId,
    ministry_id: f.ministryId || null,
    // A dry run only needs something here; nothing is saved.
    title: f.title.trim() || (dryRun ? "Availability check" : ""),
    description: t(f.description),
    point_person: t(f.pointPerson),
    requester_name: t(f.requesterName),
    start_time: f.startTime || null,
    end_time: f.endTime || null,
    setup_time: f.setupTime || null,
    setdown_time: f.setdownTime || null,
    recurrence: "none" as const,
    booking_date: f.date,
    end_date: f.endDate || null,
  };
}

/** What happens to this request, in the web form's words. */
export function approvalNote(requiresApproval: boolean, canApprove: boolean): string {
  if (requiresApproval && canApprove) return "This space needs approval. Yours confirms straight away because you're a booking manager.";
  if (!requiresApproval) return "Instant confirmation: this space doesn't need approval.";
  return "Goes to the booking manager for approval.";
}

// ── Vehicles: purpose, drivers, validation ──────────────────────────────────

export const PURPOSE_OPTIONS = [
  { value: "international_team", label: "International team" },
  { value: "ministry", label: "Ministry related events" },
  { value: "airport_run", label: "Airport run" },
  { value: "personal", label: "Personal use" },
  { value: "other", label: "Other" },
] as const;
export type Purpose = (typeof PURPOSE_OPTIONS)[number]["value"];

export function purposeLabel(value: string): string {
  return PURPOSE_OPTIONS.find((p) => p.value === value)?.label ?? value;
}

export type DriverPick = {
  userId: string;
  name: string;
  phone: string;
  hasSaLicense: boolean;
  isFirstTime: boolean;
};

export type VehicleForm = {
  checkout: string;
  returnDate: string;
  vehicleIds: string[];
  drivers: DriverPick[];
  bookingName: string;
  pointPerson: string;
  destination: string;
  purpose: Purpose;
  purposeNote: string;
  numPeople: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  /** Two-letter code; the web's picker defaults to ZA. */
  homeCountry: string;
  notes: string;
};

export const EMPTY_VEHICLE: VehicleForm = {
  checkout: "",
  returnDate: "",
  vehicleIds: [],
  drivers: [],
  bookingName: "",
  pointPerson: "",
  destination: "",
  purpose: "ministry",
  purposeNote: "",
  numPeople: "",
  requesterName: "",
  requesterEmail: "",
  requesterPhone: "",
  homeCountry: "ZA",
  notes: "",
};

/** "ZA", "za" or "South Africa" → "ZA"; other names → "" (the web's toIso2, narrowed). */
export function toIso2(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (v.length === 2) return v.toUpperCase();
  return v.toLowerCase() === "south africa" ? "ZA" : "";
}

export type Eligibility = { ok: true } | { ok: false; reason: string; message: string };

/**
 * The web's checkDriverEligibility (src/lib/vehicles/licence.ts). "request"
 * checks the licence and passport only; "approval" adds the driving test.
 * A HINT in the app: the API re-reads the licence from the database at
 * submit and again at approval.
 */
export function driverEligibility(p: Person, returnDate: string | null, stage: "request" | "approval", today = todayISO()): Eligibility {
  if (!p.licence_file_url || !p.licence_expiry_date) {
    return { ok: false, reason: "no_licence", message: "No driver's licence on file. Ask them to add one to their profile." };
  }
  if (p.passport_file_url === null) {
    return { ok: false, reason: "no_passport", message: "No passport photo on file. Ask them to add one to their profile." };
  }
  if (p.licence_expiry_date < today) {
    return { ok: false, reason: "expired", message: `Licence expired on ${p.licence_expiry_date}.` };
  }
  if (returnDate && p.licence_expiry_date < returnDate) {
    return { ok: false, reason: "expires_before_return", message: `Licence expires on ${p.licence_expiry_date}, before the return date.` };
  }
  if (stage === "request") return { ok: true };
  if (p.base_driving_test_status === "failed") {
    return { ok: false, reason: "test_failed", message: "Did not pass the base-vehicle driving test." };
  }
  if (p.base_driving_test_status === "pending") {
    return { ok: false, reason: "test_pending", message: "Still needs to pass the base-vehicle driving test." };
  }
  return { ok: true };
}

/** The picker's status line (the web's licenceStatusLabel). */
export function licenceStatus(p: Person, returnDate: string | null, today = todayISO()): { label: string; tone: "ok" | "warn" | "bad" } {
  const check = driverEligibility(p, returnDate, "approval", today);
  if (check.ok) return { label: `Licence valid to ${p.licence_expiry_date}`, tone: "ok" };
  return { label: check.message, tone: check.reason === "test_pending" ? "warn" : "bad" };
}

/** How the web fills a driver row from a Hub profile. */
export function driverFromPerson(p: Person): DriverPick {
  return {
    userId: p.id,
    name: p.name,
    phone: p.phone ?? "",
    hasSaLicense: toIso2(p.country) === "ZA",
    isFirstTime: p.base_driving_test_status === "pending",
  };
}

export function vehicleWhenError(f: VehicleForm): string | null {
  if (!f.checkout || !f.returnDate) return "Please choose collection and return dates.";
  if (f.returnDate < f.checkout) return "The return date must be on or after the collection date.";
  return null;
}

export function vehicleChoiceError(f: VehicleForm, unavailableIds: string[]): string | null {
  if (f.vehicleIds.some((id) => unavailableIds.includes(id))) return "One or more chosen vehicles is unavailable for those dates.";
  return null;
}

export function driversError(f: VehicleForm, people: Person[], today = todayISO()): string | null {
  if (f.drivers.length === 0) return "Add at least one driver.";
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const d of f.drivers) {
    const p = byId.get(d.userId);
    if (!p) continue;
    const check = driverEligibility(p, f.returnDate || null, "request", today);
    if (!check.ok) return `${p.name} cannot be added as a driver: ${check.message}`;
  }
  return null;
}

export function vehicleDetailsError(f: VehicleForm): string | null {
  if (!f.bookingName.trim()) return "Please enter a booking name (team or person).";
  if (!f.pointPerson.trim()) return "Please enter the point person for this booking.";
  if (!f.destination.trim()) return "Please say where you plan to go with the vehicle.";
  if (f.purpose === "other" && !f.purposeNote.trim()) return "Please describe the purpose.";
  if (f.numPeople.trim() && !/^\d+$/.test(f.numPeople.trim())) return "Number of people must be a whole number.";
  if (!/^[A-Za-z]{2}$/.test(f.homeCountry.trim())) return "Home country must be a two-letter code, like ZA or US.";
  return null;
}

export function vehiclePayload(f: VehicleForm) {
  const t = (v: string) => v.trim() || null;
  const n = parseInt(f.numPeople, 10);
  return {
    booking_name: f.bookingName.trim(),
    point_person: f.pointPerson.trim(),
    destination: f.destination.trim(),
    purpose: f.purpose,
    purpose_note: f.purpose === "other" ? f.purposeNote.trim() : null,
    requester_name: t(f.requesterName),
    requester_email: t(f.requesterEmail),
    requester_phone: t(f.requesterPhone),
    num_people: Number.isFinite(n) && n > 0 ? n : null,
    checkout_date: f.checkout,
    return_date: f.returnDate,
    home_country: f.homeCountry.trim().toUpperCase() || null,
    notes: t(f.notes),
    vehicle_ids: f.vehicleIds,
    drivers: f.drivers.map((d) => ({
      user_id: d.userId,
      name: d.name,
      phone: d.phone,
      has_sa_license: d.hasSaLicense,
      is_first_time: d.isFirstTime,
    })),
  };
}

/**
 * The availability dry run. The website's create route checks the name,
 * destination and point person BEFORE it answers a dry run, so a dry run
 * needs placeholders there (nothing is saved).
 */
export function vehicleDryRunPayload(checkout: string, returnDate: string, vehicleIds: string[] = []) {
  return {
    dryRun: true,
    booking_name: "Availability check",
    destination: "Availability check",
    point_person: "Availability check",
    checkout_date: checkout,
    return_date: returnDate,
    vehicle_ids: vehicleIds,
  };
}

// ── Vehicle collection / return check (the web's inspection form) ──────────

export type InspectionKind = "collection" | "return";

/** Walk-around panels, from the web (DAMAGE_PANELS). */
export const DAMAGE_PANELS = [
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
] as const;

/** In-vehicle inventory, from the web (INVENTORY_ITEMS). */
export const INVENTORY_ITEMS = [
  { key: "car_jack", label: "Car jack" },
  { key: "wheel_spanner", label: "Wheel spanner" },
  { key: "emergency_triangle", label: "Emergency triangle" },
  { key: "vests", label: "Emergency vests (×2)" },
  { key: "spare_tyre", label: "Spare tyre (condition checked)" },
] as const;

export type PhotoKind = "damage_photo" | "license" | "carwash_receipt" | "fuel_gauge";

export type InspectionForm = {
  vehicleId: string;
  mileage: string;
  driverNames: string;
  allDriversPresent: boolean | null;
  usagePurpose: string;
  saLicenseConfirmed: boolean | null;
  damagePanels: string[];
  inventory: Record<string, boolean>;
  checkinDate: string;
  washed: boolean;
  fuelFull: boolean;
  damageReported: boolean;
  communicatedTruthfully: boolean;
  inspectionPermission: boolean;
  notes: string;
  agreed: boolean;
};

export function emptyInspection(defaults: { vehicleId: string; driverNames: string; usagePurpose: string; checkinDate: string }): InspectionForm {
  return {
    vehicleId: defaults.vehicleId,
    mileage: "",
    driverNames: defaults.driverNames,
    allDriversPresent: null,
    usagePurpose: defaults.usagePurpose,
    saLicenseConfirmed: null,
    damagePanels: [],
    inventory: Object.fromEntries(INVENTORY_ITEMS.map((i) => [i.key, true])),
    checkinDate: defaults.checkinDate,
    washed: false,
    fuelFull: false,
    damageReported: false,
    communicatedTruthfully: false,
    inspectionPermission: false,
    notes: "",
    agreed: false,
  };
}

/** The web form's checks, in its order and words. `photos` counts saved + sent photos by kind. */
export function inspectionError(kind: InspectionKind, f: InspectionForm, photos: Partial<Record<PhotoKind, number>>): string | null {
  if (!f.mileage.trim()) return "Please enter the vehicle mileage.";
  if (!/^\d+$/.test(f.mileage.trim())) return "Mileage must be a whole number of kilometres.";
  if (f.allDriversPresent === null) return "Please confirm whether every driver is present.";
  if (kind === "collection") {
    if (!f.usagePurpose.trim()) return "Please say what the vehicle is being used for.";
    if (f.saLicenseConfirmed === null) return "Please confirm whether the driver holds a valid SA licence.";
  } else {
    if (!f.checkinDate) return "Please enter the check-in date.";
    if (f.washed && !(photos.carwash_receipt ?? 0)) return "Please attach the carwash receipt, or untick 'washed'.";
    if (f.fuelFull && !(photos.fuel_gauge ?? 0)) return "Please attach a photo of the fuel gauge, or untick 'refuelled'.";
    if (!f.communicatedTruthfully || !f.inspectionPermission) return "Please agree to both return declarations before submitting.";
  }
  if (!f.agreed) return "Please confirm the declaration before submitting.";
  return null;
}

/** POST /api/vehicles/inspections body, exactly as the web sends it. */
export function inspectionPayload(bookingId: string, kind: InspectionKind, f: InspectionForm) {
  const isCollection = kind === "collection";
  return {
    vehicle_booking_id: bookingId,
    vehicle_id: f.vehicleId || null,
    kind,
    driver_names: f.driverNames.trim() || null,
    mileage: parseInt(f.mileage, 10),
    damage_panels: isCollection ? f.damagePanels : [],
    inventory: isCollection ? f.inventory : {},
    washed: isCollection ? null : f.washed,
    fuel_full: isCollection ? null : f.fuelFull,
    damage_reported: isCollection ? null : f.damageReported,
    condition_notes: f.notes.trim() || null,
    declaration_agreed: f.agreed,
    all_drivers_present: f.allDriversPresent,
    usage_purpose: isCollection ? f.usagePurpose.trim() || null : null,
    sa_license_confirmed: isCollection ? f.saLicenseConfirmed : null,
    checkin_date: isCollection ? null : f.checkinDate || null,
    communicated_truthfully: isCollection ? null : f.communicatedTruthfully,
    inspection_permission: isCollection ? null : f.inspectionPermission,
  };
}
