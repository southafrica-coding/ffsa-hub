/**
 * An in-memory stand-in for ./hub-data, for the hub-leader tests only.
 * Same function names and shapes; every value is made up. Tests mock
 * ./hub-data with makeFakeHub(state) and inspect state afterwards.
 * By default nobody has any Hub permission: tests grant what they need.
 */

import type {
  AccountState,
  BookingAccess,
  ContactDetail,
  EmailLine,
  FormLite,
  HireItem,
  SpaceBookingLite,
  VehicleAccess,
  VehicleBookingLite,
  VehicleLite,
  VehiclePerson,
} from "./hub-data";

export const CONTACT_CAROL = "c0000000-0000-4000-8000-000000000001";
export const CONTACT_CARL = "c0000000-0000-4000-8000-000000000002";
export const VB_1 = "b0000000-0000-4000-8000-000000000001";
export const SB_1 = "b0000000-0000-4000-8000-000000000002";

const NONE_V: VehicleAccess = { isAdmin: false, canView: false, canRequest: false, canApprove: false, canManage: false };
const NONE_B: BookingAccess = { isAdmin: false, canView: false, canRequest: false, canApprove: false, canManage: false };

export type HubState = {
  vehicleAccess: Record<string, Partial<VehicleAccess>>;
  bookingAccess: Record<string, Partial<BookingAccess>>;
  contactsRead: Set<string>;
  contactsEdit: Set<string>;
  forms: Set<string>;
  emailLog: Set<string>;
  vehicles: VehicleLite[];
  held: string[];
  people: VehiclePerson[];
  /** user id → why they can't drive (the licence rule's message). */
  driverBlocks: Record<string, string>;
  vehicleBookings: VehicleBookingLite[];
  spaceBookings: SpaceBookingLite[];
  contacts: ContactDetail[];
  formsList: FormLite[];
  hire: HireItem[];
  accounts: Record<string, AccountState>;
  emails: Record<string, EmailLine[]>;
  // What got written or sent:
  createdVehicles: Record<string, unknown>[];
  contactUpdates: { id: string; patch: Record<string, unknown> }[];
  vehicleDecisions: { userId: string; id: string; decision: string; note: string | null }[];
  spaceDecisions: { userId: string; id: string; decision: string; note: string | null }[];
  decideVehicleResult: { ok: true } | { ok: false; error: string; status: number };
};

export function baseHubState(): HubState {
  return {
    vehicleAccess: {},
    bookingAccess: {},
    contactsRead: new Set(),
    contactsEdit: new Set(),
    forms: new Set(),
    emailLog: new Set(),
    vehicles: [
      { id: "v-quantum", name: "Quantum", vehicle_type: "van", seats: 14, make_model: "Toyota Quantum" },
      { id: "v-polo", name: "Polo", vehicle_type: "car", seats: 5, make_model: "VW Polo" },
    ],
    held: [],
    people: [
      person("u-lead", "Lee Leader", "lee@example.test", "ZA"),
      person("u-amy", "Amy Adams", "amy@example.test", "ZA"),
      person("u-ben", "Ben Brown", "ben@example.test", "Kenya"),
    ],
    driverBlocks: {},
    vehicleBookings: [],
    spaceBookings: [],
    contacts: [
      contact(CONTACT_CAROL, "Carol", "Contact", { city: "Cape Town", email: "carol@example.test" }),
      contact(CONTACT_CARL, "Carl", "Contact", { email: "carl@example.test" }),
    ],
    formsList: [{ id: "f-1", name: "Volunteer sign-up", slug: "volunteer", active: true, event: null, submissions: 3, updated_at: "2026-11-01" }],
    hire: [{ name: "PA speaker", stock: 4, free: 2, price: "R350.00 per day" }],
    accounts: {},
    emails: {},
    createdVehicles: [],
    contactUpdates: [],
    vehicleDecisions: [],
    spaceDecisions: [],
    decideVehicleResult: { ok: true },
  };
}

function person(id: string, name: string, email: string, country: string): VehiclePerson {
  return {
    id,
    name,
    email,
    phone: "+27 00 000 0000",
    country,
    licence_expiry_date: "2030-01-01",
    licence_file_url: "on-file",
    passport_file_url: "on-file",
    base_driving_test_status: "not_required",
  };
}

const CONTACT_KEYS = [
  "first_name", "last_name", "preferred_name", "date_of_birth", "gender", "marital_status", "nationality",
  "preferred_language", "preferred_channel", "address_line_1", "address_line_2", "city", "province", "postal_code", "country",
] as const;

export function contact(id: string, first: string, last: string, extra: Record<string, string | null> = {}): ContactDetail {
  const c: Record<string, string | null> = {};
  for (const k of CONTACT_KEYS) c[k] = null;
  return { ...c, id, first_name: first, last_name: last, name: `${first} ${last}`, email: null, phone: null, status: "active", ...extra } as ContactDetail;
}

export const vehicleBookingRow = (id: string, extra: Partial<VehicleBookingLite> = {}): VehicleBookingLite => ({
  id,
  booking_name: "Outreach team",
  status: "pending",
  checkout_date: "2030-03-01",
  return_date: "2030-03-03",
  destination: "Stellenbosch",
  requester_name: "Amy Adams",
  requested_by: "u-amy",
  decision_note: null,
  vehicles: [],
  ...extra,
});

export const spaceBookingRow = (id: string, extra: Partial<SpaceBookingLite> = {}): SpaceBookingLite => ({
  id,
  title: "Worship practice",
  status: "pending",
  booking_date: "2030-03-02",
  end_date: null,
  start_time: "18:00:00",
  end_time: "20:00:00",
  venue: "Auditorium",
  ministry: "Worship",
  requester_name: "Ben Brown",
  requested_by: "u-ben",
  series_id: null,
  venue_id: "venue-1",
  ...extra,
});

export function makeFakeHub(s: HubState) {
  return {
    CONTACT_FIELDS: CONTACT_KEYS,
    vehicleAccess: async (_a: unknown, id: string) => {
      const v = { ...NONE_V, ...(s.vehicleAccess[id] ?? {}) };
      if (v.isAdmin) return { isAdmin: true, canView: true, canRequest: true, canApprove: true, canManage: true };
      return { ...v, canView: v.canView || v.canRequest || v.canApprove || v.canManage };
    },
    bookingAccess: async (_a: unknown, id: string) => ({ ...NONE_B, ...(s.bookingAccess[id] ?? {}) }),
    contactsReadAccess: async (_a: unknown, id: string) => s.contactsRead.has(id),
    contactsEditAccess: async (_a: unknown, id: string) => s.contactsEdit.has(id),
    formsAccess: async (_a: unknown, id: string) => s.forms.has(id),
    emailLogAccess: async (_a: unknown, id: string) => s.emailLog.has(id),

    listActiveVehicles: async () => s.vehicles,
    vehicleDayCounts: async (_a: unknown, from: string) => [
      { day: from, vans: 1, cars: 1, vanTotal: 1, carTotal: 1, vansRequested: 0, carsRequested: 0 },
    ],
    heldVehicleIds: async () => s.held,
    vehiclePeople: async () => s.people,
    prepareVehicleDrivers: async (_a: unknown, drivers: { user_id?: string | null; name?: string; is_first_time?: boolean }[] | undefined) => {
      const list = (drivers ?? []).filter((d) => d.name);
      if (list.length === 0) return { ok: false as const, status: 400, error: "Add at least one driver" };
      for (const d of list) {
        const why = d.user_id ? s.driverBlocks[d.user_id] : undefined;
        if (why) return { ok: false as const, status: 400, error: `${d.name} cannot be added as a driver — ${why}` };
      }
      return {
        ok: true as const,
        pendingTestUserIds: [],
        drivers: list.map((d) => ({
          user_id: d.user_id ?? null,
          name: d.name ?? null,
          phone: null,
          has_sa_license: true,
          is_first_time: !!d.is_first_time,
          driving_test_status: d.is_first_time ? "pending" : "not_required",
          licence_expiry_snapshot: null,
          licence_number_snapshot: null,
        })),
      };
    },
    userDisplayName: async (_a: unknown, id: string) => s.people.find((p) => p.id === id)?.name ?? null,
    createVehicleRequest: async (_a: unknown, args: Record<string, unknown>) => {
      s.createdVehicles.push(args);
      return { ok: true as const, bookingId: "vb-new", drivers: [] };
    },
    myVehicleRequests: async (_a: unknown, id: string) => s.vehicleBookings.filter((b) => b.requested_by === id),
    vehicleBookingsBetween: async () => s.vehicleBookings,
    pendingVehicleBookings: async () => s.vehicleBookings.filter((b) => b.status === "pending"),
    vehicleBooking: async (_a: unknown, id: string) => s.vehicleBookings.find((b) => b.id === id) ?? null,
    vehicleBookingDrivers: async () => [],
    decideVehicle: async (_a: unknown, userId: string, id: string, decision: string, note: string | null) => {
      if (s.decideVehicleResult.ok) {
        s.vehicleDecisions.push({ userId, id, decision, note });
        const b = s.vehicleBookings.find((x) => x.id === id);
        if (b) b.status = decision;
      }
      return s.decideVehicleResult;
    },

    spaceBookingsBetween: async () => s.spaceBookings,
    pendingSpaceBookings: async () => s.spaceBookings.filter((b) => b.status === "pending"),
    spaceBooking: async (_a: unknown, id: string) => s.spaceBookings.find((b) => b.id === id) ?? null,
    decideSpace: async (_a: unknown, userId: string, booking: SpaceBookingLite, decision: string, note: string | null) => {
      s.spaceDecisions.push({ userId, id: booking.id, decision, note });
      const b = s.spaceBookings.find((x) => x.id === booking.id);
      if (b) b.status = decision;
      return { ok: true as const };
    },

    searchContacts: async (_a: unknown, term: string) =>
      s.contacts
        .filter((c) => `${c.name} ${c.email ?? ""}`.toLowerCase().includes(term.toLowerCase()))
        .map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, status: c.status })),
    contactById: async (_a: unknown, id: string) => s.contacts.find((c) => c.id === id) ?? null,
    genderOptions: async () => ["female", "male"],
    applyContactUpdate: async (_a: unknown, id: string, patch: Record<string, unknown>) => {
      s.contactUpdates.push({ id, patch });
      const c = s.contacts.find((x) => x.id === id) as Record<string, unknown> | undefined;
      if (c) Object.assign(c, patch);
      return { error: null };
    },

    listForms: async () => s.formsList,
    hireStock: async () => ({ items: s.hire, error: null }),
    accountState: async (_a: unknown, id: string) => s.accounts[id] ?? null,
    recentEmailsTo: async (_a: unknown, email: string) => s.emails[email] ?? [],
  };
}
