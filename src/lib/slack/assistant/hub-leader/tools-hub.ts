/**
 * The "Hub" assistant's tools beyond team access: Hub help, vehicles,
 * space bookings, approvals, contacts, forms, hire stock and problem
 * reports.
 *
 * Every tool checks the asker's own Hub permissions, fresh, with the same
 * helper the Hub's page or route uses (hub-data.ts), and never returns
 * more than that page would show them. A refusal never says whether a
 * record exists. Writes only *propose*: the leader gets a button, and
 * actions.ts runs the same check* function below again before writing.
 *
 * Arguments come from the model, so every one is validated here: ids must
 * be UUIDs, dates real ISO dates, free text trimmed and capped, names
 * matched only against lists the asker may see.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { countries } from "@/lib/countries";
import { CLASH_ERROR, validateVehicleRequestFields, VEHICLE_PURPOSES } from "@/lib/vehicles/booking-request";
import { purposeLabel } from "@/services/vehicles";
import * as hub from "./hub-data";
import { investigate } from "./investigate";
import { searchHelp } from "./knowledge";
import { propose, type ToolContext, type ToolOutcome } from "./propose";
import { matchPerson, type Person } from "./rules";
import { reportProblem } from "./tickets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

const dateProp = (what: string) => ({ type: "string", description: `${what}, as YYYY-MM-DD.` });

export const HUB_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_hub_help",
    description:
      "Look up how something works in the Hub, from the Hub's own help. Use this for EVERY how-to question; answer only from what it returns. If it finds nothing, say you don't know and offer to file a problem report.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string", description: "The leader's question, in their words." } },
      required: ["question"],
    },
  },
  {
    name: "check_vehicle_availability",
    description:
      "How many vans and cars are free each day between two dates, and which vehicles are free for the whole window. Read-only.",
    input_schema: {
      type: "object",
      properties: { from: dateProp("First day"), to: dateProp("Last day (31 days at most)") },
      required: ["from", "to"],
    },
  },
  {
    name: "request_vehicle_booking",
    description:
      "Check a vehicle request against the Hub's rules (fields, vehicle clashes, driver licences) and, if it passes, set it up for the leader to press 'Request vehicle'. Does NOT book anything by itself. Drivers must be people in the Hub (name or email, or \"me\"); outside drivers need photos, so send those to the Hub form.",
    input_schema: {
      type: "object",
      properties: {
        booking_name: { type: "string", description: "Team or person the booking is for." },
        point_person: { type: "string", description: "Who the co-ordinator should contact about it." },
        destination: { type: "string", description: "Where they plan to go." },
        purpose: { type: "string", enum: VEHICLE_PURPOSES },
        purpose_note: { type: "string", description: "Required when purpose is other." },
        checkout_date: dateProp("Collection date"),
        return_date: dateProp("Return date"),
        num_people: { type: "integer" },
        vehicles: { type: "array", items: { type: "string" }, description: "Optional vehicle names, from check_vehicle_availability." },
        drivers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              person: { type: "string", description: "Name or email of a Hub user, or \"me\"." },
              user_id: { type: "string", description: "A user_id from an earlier candidates list." },
              is_first_time: { type: "boolean", description: "First time driving a base vehicle." },
            },
          },
        },
        notes: { type: "string" },
      },
      required: ["booking_name", "point_person", "destination", "purpose", "checkout_date", "return_date", "drivers"],
    },
  },
  {
    name: "list_vehicle_bookings",
    description:
      "Vehicle bookings. scope 'mine' = the leader's own requests (any status). scope 'all' = every booking overlapping the dates, only for vehicle approvers/managers.",
    input_schema: {
      type: "object",
      properties: { scope: { type: "string", enum: ["mine", "all"] }, from: dateProp("First day"), to: dateProp("Last day") },
      required: ["scope"],
    },
  },
  {
    name: "list_space_bookings",
    description: "Space (venue) bookings overlapping the dates, if the leader can see space bookings in the Hub. mine_only for their own.",
    input_schema: {
      type: "object",
      properties: { from: dateProp("First day"), to: dateProp("Last day (62 days at most)"), mine_only: { type: "boolean" } },
      required: ["from", "to"],
    },
  },
  {
    name: "list_pending_approvals",
    description:
      "Requests waiting for a decision that this leader may approve in the Hub (vehicle bookings, space bookings). Each has a kind and an id for decide_request.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "decide_request",
    description:
      "Set up approving or declining one pending request from list_pending_approvals. Does NOT decide by itself: the leader gets an Approve or Decline button. The reason is sent to the requester; ask for one when declining.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["vehicle", "space"] },
        id: { type: "string" },
        decision: { type: "string", enum: ["approve", "decline"] },
        reason: { type: "string" },
      },
      required: ["kind", "id", "decision"],
    },
  },
  {
    name: "find_contact",
    description:
      "Find a contact by name, email or phone (or open one by contact_id), if the leader can see contacts in the Hub. Several matches come back as candidates: ask which one.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, contact_id: { type: "string" } },
    },
  },
  {
    name: "update_contact",
    description: `Set up a change to a contact's details, if the leader may edit contacts in the Hub. Only these fields: ${hub.CONTACT_FIELDS.join(", ")}. Use null or "" to clear one. Emails, phones and labels are not editable here. Does NOT save by itself: the leader gets a Save button.`,
    input_schema: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        changes: { type: "object", description: "field → new value", additionalProperties: { type: ["string", "null"] } },
      },
      required: ["contact_id", "changes"],
    },
  },
  {
    name: "list_forms",
    description: "Hub forms with their response counts, if the leader manages Hub forms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_hire_stock",
    description: "What hire gear is free between two dates, as the public Hire page shows it. Read-only; there's no staff booking for gear in the Hub.",
    input_schema: {
      type: "object",
      properties: { from: dateProp("First day"), to: dateProp("Last day (30 days at most)"), search: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "report_problem",
    description:
      "File a problem report for the Hub team. Before filing it runs read-only checks on whatever the report is about (a team member, a vehicle or space booking id, a contact id) and returns what it found and couldn't check — tell the leader. It never fixes anything.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "What's wrong, with any detail the leader gave." },
        person: { type: "string", description: "A team member's name or email, if it's about one." },
        user_id: { type: "string" },
        vehicle_booking_id: { type: "string" },
        space_booking_id: { type: "string" },
        contact_id: { type: "string" },
      },
      required: ["message"],
    },
  },
];

export const HUB_TOOL_NAMES = new Set(HUB_TOOLS.map((t) => t.name));

// ────────────────────────────────────────────────────────────
// Argument checks
// ────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

const DAY = 86_400_000;
function dateRange(from: unknown, to: unknown, maxDays: number): { from: string; to: string } | { error: string } {
  const f = isoDate(from);
  const t = isoDate(to);
  if (!f || !t) return { error: "I need both dates as YYYY-MM-DD." };
  if (t < f) return { error: "The last day is before the first day." };
  if ((Date.parse(t) - Date.parse(f)) / DAY + 1 > maxDays) return { error: `That's more than ${maxDays} days. Ask for a shorter range.` };
  return { from: f, to: t };
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Escape a value for Slack mrkdwn, so a stored value can't become a mention or link. */
export const slackSafe = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const refuse = (reason: string): ToolOutcome => ({ output: { refused: true, reason } });

// ────────────────────────────────────────────────────────────
// Vehicles
// ────────────────────────────────────────────────────────────

const canBookVehicles = (a: hub.VehicleAccess) => a.canRequest || a.canApprove || a.canManage;
const canSeeAllVehicles = (a: hub.VehicleAccess) => a.isAdmin || a.canApprove || a.canManage;
export const NO_VEHICLE_REQUEST = "You can't request vehicles in the Hub, so I can't request one for you. Ask a Hub admin if you need vehicle access.";

function iso2(value: string | null): string {
  if (!value) return "";
  const v = value.trim();
  if (v.length === 2) return v.toUpperCase();
  return countries.find((c) => c.name.toLowerCase() === v.toLowerCase())?.iso2 ?? "";
}

export type VehicleRequestPayload = {
  booking_name: string;
  point_person: string;
  destination: string;
  purpose: string;
  purpose_note: string | null;
  checkout_date: string;
  return_date: string;
  num_people: number | null;
  notes: string | null;
  vehicle_ids: string[];
  drivers: { user_id: string; is_first_time: boolean }[];
};

type Candidates = { needs_clarification: true; message: string; candidates: unknown[] };

/** Turn the model's request into a payload: vehicles by name, drivers among Hub users. */
async function vehiclePayloadFrom(
  admin: Client,
  leaderId: string,
  input: Record<string, unknown>
): Promise<{ payload: VehicleRequestPayload } | { output: Candidates | { refused: true; reason: string } }> {
  const vehicles = await hub.listActiveVehicles(admin);
  const vehicleIds: string[] = [];
  for (const raw of Array.isArray(input.vehicles) ? input.vehicles.slice(0, 6) : []) {
    const term = text(raw, 80).toLowerCase();
    if (!term) continue;
    const exact = vehicles.filter((v) => v.name.toLowerCase() === term || v.id === term);
    const hits = exact.length > 0 ? exact : vehicles.filter((v) => `${v.name} ${v.make_model ?? ""}`.toLowerCase().includes(term));
    if (hits.length === 0) return { output: { refused: true, reason: `I don't know a vehicle called "${term}". Check the names with check_vehicle_availability.` } };
    if (hits.length > 1) {
      return { output: { needs_clarification: true, message: `"${term}" matches several vehicles. Ask which one.`, candidates: hits.map((v) => v.name) } };
    }
    if (!vehicleIds.includes(hits[0].id)) vehicleIds.push(hits[0].id);
  }

  const people = await hub.vehiclePeople(admin);
  const roster: Person[] = people.map((p) => ({ user_id: p.id, name: p.name, email: p.email, ministries: [] }));
  const drivers: VehicleRequestPayload["drivers"] = [];
  for (const raw of Array.isArray(input.drivers) ? input.drivers.slice(0, 8) : []) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const who = text(d.person, 120);
    const match = /^(me|myself|i)$/i.test(who)
      ? matchPerson(roster, { user_id: leaderId })
      : matchPerson(roster, { person: who, user_id: d.user_id });
    if (match.kind === "ambiguous") {
      return {
        output: {
          needs_clarification: true,
          message: "Several Hub users match that driver. Ask which one.",
          candidates: match.candidates.map((c) => ({ user_id: c.user_id, name: c.name, email: c.email })),
        },
      };
    }
    if (match.kind === "not_found") {
      return {
        output: {
          refused: true,
          reason: `I couldn't find a Hub user called "${who || "that"}" to drive. Drivers from outside the Hub need their licence and passport photos attached, so use the request form in the Hub for them.`,
        },
      };
    }
    if (!drivers.some((x) => x.user_id === match.person.user_id)) {
      drivers.push({ user_id: match.person.user_id, is_first_time: d.is_first_time === true });
    }
  }

  const n = typeof input.num_people === "number" && Number.isInteger(input.num_people) && input.num_people > 0 ? Math.min(input.num_people, 100) : null;
  return {
    payload: {
      booking_name: text(input.booking_name, 120),
      point_person: text(input.point_person, 120),
      destination: text(input.destination, 200),
      purpose: VEHICLE_PURPOSES.includes(text(input.purpose)) ? text(input.purpose) : "ministry",
      purpose_note: text(input.purpose_note, 300) || null,
      checkout_date: text(input.checkout_date, 10),
      return_date: text(input.return_date, 10),
      num_people: n,
      notes: text(input.notes, 1000) || null,
      vehicle_ids: vehicleIds,
      drivers,
    },
  };
}

export type CheckedVehicleRequest = {
  ok: true;
  body: hub.VehicleRequestBody;
  fields: hub.RequestFields;
  requesterName: string | null;
  requestedIds: string[];
  drivers: hub.PreparedDriver[];
  pendingTestUserIds: string[];
  summary: string;
};

/**
 * Everything POST /api/vehicles/bookings checks, in the same order and
 * with the same words, plus the form's own "describe the purpose" rule.
 * Run when the tool is called and again on the button press.
 */
export async function checkVehicleRequest(
  admin: Client,
  userId: string,
  p: VehicleRequestPayload
): Promise<CheckedVehicleRequest | { ok: false; reason: string }> {
  const access = await hub.vehicleAccess(admin, userId);
  if (!canBookVehicles(access)) return { ok: false, reason: NO_VEHICLE_REQUEST };

  if (!isoDate(p.checkout_date) || !isoDate(p.return_date)) return { ok: false, reason: "Collection and return dates are required (YYYY-MM-DD)." };
  const people = await hub.vehiclePeople(admin);
  const me = people.find((x) => x.id === userId) ?? null;
  const byId = new Map(people.map((x) => [x.id, x]));

  const body: hub.VehicleRequestBody = {
    booking_name: p.booking_name,
    point_person: p.point_person,
    destination: p.destination,
    purpose: p.purpose,
    purpose_note: p.purpose_note ?? undefined,
    checkout_date: p.checkout_date,
    return_date: p.return_date,
    num_people: p.num_people ?? undefined,
    notes: p.notes ?? undefined,
    // The form fills the renter from the person booking.
    requester_email: me?.email ?? undefined,
    requester_phone: me?.phone ?? undefined,
    home_country: iso2(me?.country ?? null) || "ZA",
    vehicle_ids: p.vehicle_ids,
    drivers: p.drivers.map((d) => {
      const person = byId.get(d.user_id);
      return {
        user_id: d.user_id,
        name: person?.name ?? "",
        phone: person?.phone ?? "",
        // As the form: a profile answers these, nobody self-declares them.
        has_sa_license: iso2(person?.country ?? null) === "ZA",
        is_first_time: d.is_first_time || person?.base_driving_test_status === "pending",
      };
    }),
  };

  const fields = validateVehicleRequestFields(body);
  if (!fields.ok) return { ok: false, reason: `${fields.error}.` };
  if (fields.purpose === "other" && !p.purpose_note) return { ok: false, reason: "Please describe the purpose." };

  const held = new Set(await hub.heldVehicleIds(admin, fields.checkout, fields.ret));
  const vehicles = await hub.listActiveVehicles(admin);
  const known = new Set(vehicles.map((v) => v.id));
  if (p.vehicle_ids.some((id) => !known.has(id))) return { ok: false, reason: "One of those vehicles isn't in the active fleet any more." };
  const clashing = p.vehicle_ids.filter((id) => held.has(id));
  if (clashing.length > 0) {
    const names = vehicles.filter((v) => clashing.includes(v.id)).map((v) => v.name);
    return { ok: false, reason: `${CLASH_ERROR} (${names.join(", ")})` };
  }

  if (p.drivers.some((d) => !byId.has(d.user_id))) return { ok: false, reason: "One of the drivers isn't an active Hub user." };
  const prepared = await hub.prepareVehicleDrivers(admin, body.drivers, fields.ret);
  if (!prepared.ok) return { ok: false, reason: prepared.error.endsWith(".") ? prepared.error : `${prepared.error}.` };

  const requesterName = me?.name ?? (await hub.userDisplayName(admin, userId));
  const vehicleNames = vehicles.filter((v) => p.vehicle_ids.includes(v.id)).map((v) => v.name);
  const summary = [
    `Request a vehicle: *${slackSafe(fields.bookingName)}*`,
    `${fields.checkout} → ${fields.ret} · ${purposeLabel(fields.purpose)} · to ${slackSafe(p.destination)}`,
    `Point person: ${slackSafe(p.point_person)}`,
    `Drivers: ${prepared.drivers.map((d) => d.name).join(", ")}`,
    `Vehicles: ${vehicleNames.length > 0 ? vehicleNames.join(", ") : "any (the co-ordinator assigns)"}`,
  ].join("\n");
  return {
    ok: true,
    body,
    fields: { bookingName: fields.bookingName, checkout: fields.checkout, ret: fields.ret, purpose: fields.purpose },
    requesterName,
    requestedIds: p.vehicle_ids,
    drivers: prepared.drivers,
    pendingTestUserIds: prepared.pendingTestUserIds,
    summary,
  };
}

// ────────────────────────────────────────────────────────────
// Approvals
// ────────────────────────────────────────────────────────────

export type DecisionKind = "vehicle" | "space";
export const NOT_APPROVABLE = "I can't find that request among the ones waiting for you to approve.";

export type CheckedDecision =
  | { ok: true; kind: "vehicle"; booking: hub.VehicleBookingLite; summary: string }
  | { ok: true; kind: "space"; booking: hub.SpaceBookingLite; summary: string };

/**
 * May this person decide this request in the Hub, and is it still
 * waiting? Vehicles: the decision route's isAdmin / canApprove /
 * canManage. Spaces: the decision route's canApprove. Only pending
 * requests — a miss reads the same whether or not the id exists.
 */
export async function checkDecision(
  admin: Client,
  userId: string,
  kind: unknown,
  id: unknown,
  decision: "approved" | "denied",
  note: string | null
): Promise<CheckedDecision | { ok: false; reason: string }> {
  const verb = decision === "approved" ? "Approve" : "Decline";
  const why = note ? `\nReason (sent to them): ${slackSafe(note)}` : "";
  if (kind === "vehicle") {
    const access = await hub.vehicleAccess(admin, userId);
    if (!canSeeAllVehicles(access)) return { ok: false, reason: "You can't approve vehicle requests in the Hub." };
    if (!isUuid(id)) return { ok: false, reason: NOT_APPROVABLE };
    const booking = await hub.vehicleBooking(admin, id);
    if (!booking || booking.status !== "pending") return { ok: false, reason: NOT_APPROVABLE };
    return {
      ok: true,
      kind,
      booking,
      summary: `${verb} the vehicle request *${slackSafe(booking.booking_name)}* (${booking.checkout_date} → ${booking.return_date}) from ${slackSafe(booking.requester_name ?? "someone")}?${why}`,
    };
  }
  if (kind === "space") {
    const access = await hub.bookingAccess(admin, userId);
    if (!access.canApprove) return { ok: false, reason: "You can't approve space bookings in the Hub." };
    if (!isUuid(id)) return { ok: false, reason: NOT_APPROVABLE };
    const booking = await hub.spaceBooking(admin, id);
    if (!booking || booking.status !== "pending") return { ok: false, reason: NOT_APPROVABLE };
    const when = [booking.booking_date, booking.start_time && `${booking.start_time.slice(0, 5)}–${(booking.end_time ?? "").slice(0, 5)}`].filter(Boolean).join(" ");
    const series = booking.series_id ? "\nThis is one date of a recurring series; the other dates stay as they are (decide the whole series in the Hub)." : "";
    return {
      ok: true,
      kind,
      booking,
      summary: `${verb} the space booking *${slackSafe(booking.title)}* in ${slackSafe(booking.venue ?? "a venue")} on ${when} from ${slackSafe(booking.requester_name ?? "someone")}?${why}${series}`,
    };
  }
  return { ok: false, reason: "I can only decide vehicle or space requests." };
}

// ────────────────────────────────────────────────────────────
// Contacts
// ────────────────────────────────────────────────────────────

export const NO_CONTACTS = "You can't see contacts in the Hub, so I can't look them up for you.";
export const NO_CONTACT_EDIT = "You can't edit contacts in the Hub, so I can't change one for you.";
export const CONTACT_NOT_FOUND = "I couldn't find that contact.";
const MARITAL = ["single", "married", "divorced", "widowed"];

export type CheckedContactUpdate = {
  ok: true;
  contact: hub.ContactDetail;
  patch: Partial<Record<hub.ContactField, string | null>>;
  summary: string;
};

/**
 * The contact page's Edit dialog rules: the same fields, trimmed, empty
 * means cleared; marital status and gender from the dialog's choices
 * (gender may stay as it is); date of birth a real date, not in the
 * future. Only fields that actually change are kept.
 */
export async function checkContactUpdate(
  admin: Client,
  userId: string,
  contactId: unknown,
  changes: unknown
): Promise<CheckedContactUpdate | { ok: false; reason: string }> {
  if (!(await hub.contactsReadAccess(admin, userId))) return { ok: false, reason: NO_CONTACTS };
  if (!(await hub.contactsEditAccess(admin, userId))) return { ok: false, reason: NO_CONTACT_EDIT };
  if (!isUuid(contactId)) return { ok: false, reason: CONTACT_NOT_FOUND };
  const contact = await hub.contactById(admin, contactId);
  if (!contact) return { ok: false, reason: CONTACT_NOT_FOUND };
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { ok: false, reason: "Which details should change?" };

  const allowed = new Set<string>(hub.CONTACT_FIELDS);
  const patch: Partial<Record<hub.ContactField, string | null>> = {};
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(changes as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `I can't change \`${key}\` here. I can change: ${hub.CONTACT_FIELDS.join(", ")}. Emails, phones and labels are changed on the contact's page.` };
    }
    if (raw !== null && typeof raw !== "string") return { ok: false, reason: `${key} needs to be text.` };
    const value = (raw ?? "").trim() === "" ? null : (raw as string).trim();
    if (value && value.length > 200) return { ok: false, reason: `${key} is too long.` };
    const field = key as hub.ContactField;
    if (field === "first_name" && !value) return { ok: false, reason: "A contact needs a first name." };
    if (field === "date_of_birth" && value) {
      if (!isoDate(value)) return { ok: false, reason: "Date of birth needs to be a real date, as YYYY-MM-DD." };
      if (value > new Date().toISOString().slice(0, 10)) return { ok: false, reason: "Date of birth can't be in the future." };
    }
    if (field === "marital_status" && value && !MARITAL.includes(value)) {
      return { ok: false, reason: `Marital status is one of: ${MARITAL.join(", ")}.` };
    }
    if (field === "gender" && value && value !== contact.gender) {
      const options = await hub.genderOptions(admin);
      if (!options.includes(value)) return { ok: false, reason: `Gender is one of: ${options.join(", ") || "(none set up)"}.` };
    }
    if ((contact[field] ?? null) === value) continue;
    patch[field] = value;
    lines.push(`• ${field.replace(/_/g, " ")}: ${contact[field] ? slackSafe(contact[field]!) : "(empty)"} → ${value ? slackSafe(value) : "(empty)"}`);
  }
  if (lines.length === 0) return { ok: false, reason: "Those are already the contact's details, so there's nothing to change." };
  return { ok: true, contact, patch, summary: `Update *${slackSafe(contact.name)}*'s details?\n${lines.join("\n")}` };
}

// ────────────────────────────────────────────────────────────
// The dispatcher
// ────────────────────────────────────────────────────────────

const LIST_CAP = 40;

export async function executeHubTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const { admin, leader } = ctx;
  const me = leader.hubUserId;

  switch (name) {
    case "search_hub_help": {
      const question = text(input.question, 500);
      const hits = searchHelp(question);
      if (hits.length === 0) {
        return { output: { found: false, message: "The Hub's help doesn't cover that. Say so, and offer to file a problem report." } };
      }
      return { output: { found: true, topics: hits.map((t) => ({ title: t.title, text: t.body })) } };
    }

    case "check_vehicle_availability": {
      const access = await hub.vehicleAccess(admin, me);
      if (!access.canView) return refuse("You can't see vehicles in the Hub, so I can't check them for you.");
      const r = dateRange(input.from, input.to, 31);
      if ("error" in r) return { output: { error: r.error } };
      const [days, held, vehicles] = await Promise.all([
        hub.vehicleDayCounts(admin, r.from, r.to),
        hub.heldVehicleIds(admin, r.from, r.to),
        hub.listActiveVehicles(admin),
      ]);
      const heldSet = new Set(held);
      return {
        output: {
          from: r.from,
          to: r.to,
          days: days.map((d) => ({ day: d.day, vans_free: d.vans, cars_free: d.cars, vans_requested: d.vansRequested, cars_requested: d.carsRequested })),
          vehicles: vehicles.map((v) => ({ name: v.name, type: v.vehicle_type, seats: v.seats, free_whole_window: !heldSet.has(v.id) })),
          note: "Requested counts are waiting for approval and aren't taken off the free count.",
        },
      };
    }

    case "request_vehicle_booking": {
      const access = await hub.vehicleAccess(admin, me);
      if (!canBookVehicles(access)) return refuse(NO_VEHICLE_REQUEST);
      const built = await vehiclePayloadFrom(admin, me, input);
      if ("output" in built) return { output: built.output };
      const checked = await checkVehicleRequest(admin, me, built.payload);
      if (!checked.ok) return refuse(checked.reason);
      return propose(ctx, "create_vehicle_booking", { ...built.payload }, null, checked.summary, { confirmLabel: "Request vehicle" });
    }

    case "list_vehicle_bookings": {
      const access = await hub.vehicleAccess(admin, me);
      if (input.scope === "all") {
        if (!canSeeAllVehicles(access)) return refuse("Only vehicle approvers can see everyone's vehicle bookings. I can show your own requests.");
        const r = dateRange(input.from, input.to, 62);
        if ("error" in r) return { output: { error: r.error } };
        const rows = await hub.vehicleBookingsBetween(admin, r.from, r.to);
        return { output: { bookings: rows.slice(0, LIST_CAP).map(({ requested_by: _r, ...b }) => b), more: Math.max(0, rows.length - LIST_CAP) } }; // eslint-disable-line @typescript-eslint/no-unused-vars
      }
      if (!access.canView) return refuse("You can't see vehicles in the Hub.");
      const rows = await hub.myVehicleRequests(admin, me);
      return { output: { bookings: rows.slice(0, LIST_CAP).map(({ requested_by: _r, ...b }) => b), more: Math.max(0, rows.length - LIST_CAP) } }; // eslint-disable-line @typescript-eslint/no-unused-vars
    }

    case "list_space_bookings": {
      const access = await hub.bookingAccess(admin, me);
      if (!access.canView) return refuse("You can't see space bookings in the Hub, so I can't list them for you.");
      const r = dateRange(input.from, input.to, 62);
      if ("error" in r) return { output: { error: r.error } };
      let rows = await hub.spaceBookingsBetween(admin, r.from, r.to);
      if (input.mine_only === true) rows = rows.filter((b) => b.requested_by === me);
      return {
        output: {
          bookings: rows.slice(0, LIST_CAP).map(({ requested_by: _r, venue_id: _v, ...b }) => b), // eslint-disable-line @typescript-eslint/no-unused-vars
          more: Math.max(0, rows.length - LIST_CAP),
        },
      };
    }

    case "list_pending_approvals": {
      const [va, ba] = await Promise.all([hub.vehicleAccess(admin, me), hub.bookingAccess(admin, me)]);
      const items: unknown[] = [];
      if (canSeeAllVehicles(va)) {
        for (const b of await hub.pendingVehicleBookings(admin)) {
          items.push({ kind: "vehicle", id: b.id, title: b.booking_name, from: b.checkout_date, to: b.return_date, requester: b.requester_name, destination: b.destination });
        }
      }
      if (ba.canApprove) {
        for (const b of await hub.pendingSpaceBookings(admin)) {
          items.push({ kind: "space", id: b.id, title: b.title, date: b.booking_date, start: b.start_time, end: b.end_time, venue: b.venue, requester: b.requester_name, recurring: Boolean(b.series_id) });
        }
      }
      if (!canSeeAllVehicles(va) && !ba.canApprove) {
        return { output: { items: [], message: "You don't approve any requests in the Hub (vehicle or space bookings). Leave and budget requests aren't in the Hub." } };
      }
      return { output: { items: items.slice(0, LIST_CAP), more: Math.max(0, items.length - LIST_CAP) } };
    }

    case "decide_request": {
      const decision = input.decision === "approve" ? "approved" : input.decision === "decline" ? "denied" : null;
      if (!decision) return { output: { error: "Approve or decline?" } };
      const note = text(input.reason, 500) || null;
      const checked = await checkDecision(admin, me, input.kind, input.id, decision, note);
      if (!checked.ok) return refuse(checked.reason);
      return propose(
        ctx,
        checked.kind === "vehicle" ? "decide_vehicle_booking" : "decide_space_booking",
        { booking_id: checked.booking.id, decision, note },
        null,
        checked.summary,
        decision === "approved" ? { confirmLabel: "Approve" } : { confirmLabel: "Decline", danger: true }
      );
    }

    case "find_contact": {
      if (!(await hub.contactsReadAccess(admin, me))) return refuse(NO_CONTACTS);
      if (input.contact_id !== undefined) {
        const c = isUuid(input.contact_id) ? await hub.contactById(admin, input.contact_id) : null;
        return { output: c ? { contact: c } : { error: CONTACT_NOT_FOUND } };
      }
      // Only plain search characters reach the contacts search.
      const term = text(input.query, 80).replace(/[^\p{L}\p{N}@.+\-' ]/gu, " ").replace(/\s+/g, " ").trim();
      if (term.length < 2) return { output: { error: "Give me a name, email or phone number to look for." } };
      const hits = await hub.searchContacts(admin, term);
      if (hits.length === 0) return { output: { error: CONTACT_NOT_FOUND } };
      if (hits.length === 1) return { output: { contact: await hub.contactById(admin, hits[0].id) } };
      return { output: { needs_clarification: true, message: "Several contacts match. Ask which one.", candidates: hits } };
    }

    case "update_contact": {
      const checked = await checkContactUpdate(admin, me, input.contact_id, input.changes);
      if (!checked.ok) return refuse(checked.reason);
      return propose(ctx, "update_contact", { contact_id: checked.contact.id, changes: checked.patch }, null, checked.summary, { confirmLabel: "Save" });
    }

    case "list_forms": {
      if (!(await hub.formsAccess(admin, me))) return refuse("Only Hub admins and comms admins manage Hub forms, so I can't list them for you.");
      const forms = await hub.listForms(admin);
      return { output: { forms: forms.slice(0, LIST_CAP), more: Math.max(0, forms.length - LIST_CAP) } };
    }

    case "check_hire_stock": {
      const r = dateRange(input.from, input.to, 30);
      if ("error" in r) return { output: { error: r.error } };
      const { items, error } = await hub.hireStock(admin, r.from, r.to);
      if (error) return { output: { error: "I couldn't read the hire stock just now." } };
      const search = text(input.search, 60).toLowerCase();
      const shown = search ? items.filter((i) => i.name.toLowerCase().includes(search)) : items;
      return {
        output: {
          items: shown.slice(0, LIST_CAP),
          more: Math.max(0, shown.length - LIST_CAP),
          note: "To hire, send a quote request from the Hire page (/hire). Staff can't book gear inside the Hub yet.",
        },
      };
    }

    case "report_problem": {
      const message = text(input.message, 4000);
      if (!message) return { output: { error: "What's the problem? I need a short description." } };
      const evidence = await investigate(admin, leader, {
        person: input.person,
        user_id: input.user_id,
        vehicle_booking_id: input.vehicle_booking_id,
        space_booking_id: input.space_booking_id,
        contact_id: input.contact_id,
      });
      const res = await reportProblem(admin, leader, message, evidence);
      if (!res.ok) return { output: { error: "I couldn't file that just now.", findings: evidence.findings, could_not_check: evidence.could_not_check } };
      return {
        output: {
          filed: true,
          message: "Filed for the Hub team. Nothing was changed.",
          findings: evidence.findings,
          could_not_check: evidence.could_not_check,
        },
      };
    }

    default:
      return { output: { error: "That isn't something I can do." } };
  }
}
