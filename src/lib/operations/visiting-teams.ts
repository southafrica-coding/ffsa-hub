// Operations → Visiting teams: stages, Mache's checklist, due dates.
// docs/operations-outreach-teams.md. The checklist is the HOST side of
// Mache van Zyl's "FFSA: Hosting Outreach Teams" (document + Canva
// timeline), grouped by stage. Wording kept close to hers.

import { addDays, dayLabel, daysBetween } from "./dates";

// ── Stages ──────────────────────────────────────────────────
export const ACTIVE_STAGES = ["enquiry", "confirmed", "preparing", "here", "left"] as const;
export const ENDED_STAGES = ["said_no", "postponed", "cancelled"] as const;
export const STAGES = [...ACTIVE_STAGES, ...ENDED_STAGES] as const;

export type ActiveStage = (typeof ACTIVE_STAGES)[number];
export type Stage = (typeof STAGES)[number];

export const isStage = (v: unknown): v is Stage =>
  typeof v === "string" && (STAGES as readonly string[]).includes(v);
export const isActiveStage = (v: unknown): v is ActiveStage =>
  typeof v === "string" && (ACTIVE_STAGES as readonly string[]).includes(v);

export const STAGE_LABEL: Record<Stage, string> = {
  enquiry: "Enquiry",
  confirmed: "Confirmed",
  preparing: "Preparing",
  here: "Here",
  left: "Left",
  said_no: "Said no",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

/** Mache's three periods, shown above the stages. */
export const STAGE_PERIOD: Record<ActiveStage, string> = {
  enquiry: "Pre-hosting",
  confirmed: "Pre-hosting",
  preparing: "Pre-hosting",
  here: "Inter-hosting",
  left: "Post-hosting",
};

export const STAGE_TONE: Record<Stage, "good" | "warn" | "quiet" | "bad"> = {
  enquiry: "quiet",
  confirmed: "warn",
  preparing: "warn",
  here: "good",
  left: "quiet",
  said_no: "quiet",
  postponed: "quiet",
  cancelled: "quiet",
};

/** The stage after this one, or null at the end / for an ended team. */
export function nextStage(stage: Stage): ActiveStage | null {
  const i = (ACTIVE_STAGES as readonly string[]).indexOf(stage);
  return i >= 0 && i < ACTIVE_STAGES.length - 1 ? ACTIVE_STAGES[i + 1] : null;
}

// ── The checklist ───────────────────────────────────────────
/** Due N days from arrival or departure (negative = before). */
type Due = { from: "arrival" | "departure"; days: number };

export type StepTemplate = { key: string; stage: ActiveStage; label: string; due?: Due };

export const CHECKLIST: StepTemplate[] = [
  // 1–4 · first contact, set-up, the call
  { key: "first_contact", stage: "enquiry", label: "First contact received: dates, team size, heart and vision noted" },
  { key: "whatsapp_group", stage: "enquiry", label: "WhatsApp group set up with the outreach leader(s)" },
  { key: "welcoming_guide", stage: "enquiry", label: "Welcoming Guide shared (SA + Potch, or Potch only)" },
  { key: "call_scheduled", stage: "enquiry", label: "Call / video call scheduled" },
  { key: "call_done", stage: "enquiry", label: "Call done: vision, heart, why SA, locations, expectations" },

  // 5 · confirm
  { key: "yes_no", stage: "confirmed", label: "Hosting the team: yes or no decided" },
  { key: "dates_confirmed", stage: "confirmed", label: "Dates confirmed" },
  { key: "locations", stage: "confirmed", label: "Locations and ministries agreed" },
  { key: "ministries_contacted", stage: "confirmed", label: "Ministries and locations contacted with the team's heart and vision" },
  { key: "forms_shared", stage: "confirmed", label: "Team Details & Essentials form shared (Travelling Details once flights are booked)" },
  { key: "visas", stage: "confirmed", label: "Visas: connected with the Legal department (if needed)" },
  { key: "finance_told", stage: "confirmed", label: "Finance told; team added to the finance sheet" },
  { key: "wire_deadline", stage: "confirmed", label: "Wire-transfer deadlines sent to the leaders" },
  { key: "hospitality_told", stage: "confirmed", label: "Hospitality given a heads-up" },

  // 6 · forms received
  { key: "details_form_back", stage: "preparing", label: "Team Details & Essentials form back" },
  { key: "invoice", stage: "preparing", label: "Finance: sheet updated and invoice sent" },
  { key: "rooms", stage: "preparing", label: "Hospitality: rooms assigned and prepared" },
  { key: "kitchen_parents", stage: "preparing", label: "Kitchen parents told; fridge and cupboard space ready" },
  { key: "vehicles", stage: "preparing", label: "Base vehicles booked" },
  { key: "travel_form_back", stage: "preparing", label: "Team Travelling Details form back (flights)", due: { from: "arrival", days: -28 } },
  { key: "airport_pickup", stage: "preparing", label: "Airport pickup arranged", due: { from: "arrival", days: -21 } },
  { key: "ministry_schedule", stage: "preparing", label: "Ministry schedule confirmed and shared with the leaders" },
  { key: "ministry_contacts", stage: "preparing", label: "Ministry contacts shared; leaders put in touch with each location" },
  { key: "briefings", stage: "preparing", label: "Ministry and legal briefings and forms arranged for arrival (both waivers)" },
  { key: "packing_list", stage: "preparing", label: "Packing list, cultural training and things-to-know shared" },
  { key: "welcome_packets", stage: "preparing", label: "Welcome packets and cards ready (prophetic words)", due: { from: "arrival", days: -3 } },
  { key: "first_day_meals", stage: "preparing", label: "First-day meals arranged (breakfast, lunch, dinner)", due: { from: "arrival", days: -3 } },
  // 7 · pre-arrival
  { key: "base_rules", stage: "preparing", label: "Base rules, orientation and base map shared on WhatsApp", due: { from: "arrival", days: -7 } },
  { key: "rooms_final", stage: "preparing", label: "Rooms for the team (Potch) confirmed", due: { from: "arrival", days: -7 } },
  { key: "connect_people", stage: "preparing", label: "Team put in touch with the kitchen parents and airport drivers", due: { from: "arrival", days: -7 } },

  // 8 · arrival
  { key: "meet_greet", stage: "here", label: "Meet & greet", due: { from: "arrival", days: 0 } },
  { key: "settle_in", stage: "here", label: "Drivers test, settle in, buy food", due: { from: "arrival", days: 0 } },
  { key: "orientation", stage: "here", label: "Base orientation and briefing", due: { from: "arrival", days: 0 } },
  { key: "waivers", stage: "here", label: "Ministry and legal briefings done; both waivers signed by everyone", due: { from: "arrival", days: 1 } },
  { key: "schedule_run", stage: "here", label: "Ministry schedule run through with the leaders", due: { from: "arrival", days: 1 } },
  { key: "pastoral_first", stage: "here", label: "Face-to-face check-ins in the first 1–3 days", due: { from: "arrival", days: 3 } },
  // 9 · before departure
  { key: "airport_dropoff", stage: "here", label: "Airport drop-off: drivers or shuttle arranged", due: { from: "departure", days: -7 } },
  { key: "fees", stage: "here", label: "Outstanding fees followed up", due: { from: "departure", days: -3 } },
  { key: "feedback_forms", stage: "here", label: "Testimonies and feedback forms filled in", due: { from: "departure", days: -1 } },
  { key: "vehicles_back", stage: "here", label: "Base vehicles filled up and clean", due: { from: "departure", days: -1 } },
  { key: "keys_housing", stage: "here", label: "Keys handed back; housing clean", due: { from: "departure", days: 0 } },
  { key: "fridge_cleared", stage: "here", label: "Fridge and cupboard space cleared", due: { from: "departure", days: 0 } },
  { key: "thank_yous", stage: "here", label: "Thank-yous", due: { from: "departure", days: 0 } },

  // 10 · feedback
  { key: "fb_finance", stage: "left", label: "Feedback from Finance", due: { from: "departure", days: 7 } },
  { key: "fb_hospitality", stage: "left", label: "Feedback from Hospitality", due: { from: "departure", days: 7 } },
  { key: "fb_kitchen_parents", stage: "left", label: "Feedback from the kitchen parents", due: { from: "departure", days: 7 } },
  { key: "fb_ministries", stage: "left", label: "Feedback from ministry leaders, contacts and locations", due: { from: "departure", days: 7 } },
  { key: "feedback_to_leaders", stage: "left", label: "Feedback given to the outreach leaders; their feedback forms answered", due: { from: "departure", days: 14 } },
  { key: "stay_connected", stage: "left", label: "Thank-yous / stay connected", due: { from: "departure", days: 14 } },
];

export function dueFor(step: Pick<StepTemplate, "due">, arrivalOn: string | null, departureOn: string | null): string | null {
  if (!step.due) return null;
  const base = step.due.from === "arrival" ? arrivalOn : departureOn;
  return base ? addDays(base, step.due.days) : null;
}

/** New step rows for a team. Steps in stages before `stage` start ticked (done before the Hub). */
export function stepsForTeam(
  team: { stage: Stage; arrival_on: string | null; departure_on: string | null },
  doneBeforeHubNote = "Done before the Hub"
) {
  const reached = isActiveStage(team.stage) ? ACTIVE_STAGES.indexOf(team.stage) : 0;
  return CHECKLIST.map((s, sort) => {
    const before = ACTIVE_STAGES.indexOf(s.stage) < reached;
    return {
      step_key: s.key,
      stage: s.stage,
      label: s.label,
      sort,
      due_on: dueFor(s, team.arrival_on, team.departure_on),
      done_at: before ? new Date().toISOString() : null,
      note: before ? doneBeforeHubNote : null,
    };
  });
}

// ── Reading a team's checklist ──────────────────────────────
export type Step = {
  id: string;
  step_key: string;
  stage: ActiveStage;
  label: string;
  sort: number;
  due_on: string | null;
  done_at: string | null;
  note: string | null;
};

/** What's still open in one stage, soonest due first, undated last. */
export function openIn(steps: Step[], stage: ActiveStage): Step[] {
  return steps
    .filter((s) => s.stage === stage && !s.done_at)
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.sort - b.sort);
}

/** Every open step that's due within `days` of today, or past its date. */
export function dueSoon(steps: Step[], today: string, days = 7): Step[] {
  return steps
    .filter((s) => !s.done_at && s.due_on && daysBetween(today, s.due_on) <= days)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!));
}

/** True when the team's current stage has nothing left — time to suggest the next. */
export function stageDone(steps: Step[], stage: Stage): boolean {
  return isActiveStage(stage) && nextStage(stage) !== null && openIn(steps, stage).length === 0;
}

/** Field names in the history, in words. */
export const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  sending_org: "Sending organisation",
  stage: "Stage",
  dates_text: "Dates (rough)",
  arrival_on: "Arrival",
  arrival_time: "Arrival time / flight",
  departure_on: "Departure",
  departure_time: "Departure time / flight",
  size_text: "Team size",
  size_count: "Number of people",
  contact_name: "Outreach leader(s)",
  contact_role: "Their role",
  contact_email: "Leader email",
  contact_phone: "Leader phone",
  locations: "Locations in SA",
  heart_vision: "Heart and vision",
  vehicles: "Base vehicles",
  rooms: "Rooms",
  notes: "Notes",
  host_user_id: "Host",
  "private:members": "Team members",
  "private:dietary": "Dietary needs",
  "private:medical": "Medical",
};

export function fieldLabel(field: string): string {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field];
  if (field.startsWith("step:")) {
    const [, key, extra] = field.split(":");
    const step = CHECKLIST.find((s) => s.key === key);
    return `${step?.label ?? key}${extra === "note" ? " (note)" : ""}`;
  }
  return field;
}

/** Team columns the Hub lets you edit, with the kind of value. */
export const TEAM_FIELDS = {
  name: "text",
  sending_org: "text",
  dates_text: "text",
  arrival_on: "date",
  arrival_time: "text",
  departure_on: "date",
  departure_time: "text",
  size_text: "text",
  size_count: "int",
  contact_name: "text",
  contact_role: "text",
  contact_email: "text",
  contact_phone: "text",
  locations: "text",
  heart_vision: "text",
  vehicles: "text",
  rooms: "text",
  notes: "text",
} as const;

export type TeamField = keyof typeof TEAM_FIELDS;
export const PRIVATE_FIELDS = ["members", "dietary", "medical"] as const;
export type PrivateField = (typeof PRIVATE_FIELDS)[number];

/** Check and clean an edit to a team. Returns the patch, or an error in words. */
export function cleanTeamPatch(
  body: Record<string, unknown>,
  current: { arrival_on: string | null; departure_on: string | null } = { arrival_on: null, departure_on: null }
): { patch: Record<string, string | number | null> } | { error: string } {
  const patch: Record<string, string | number | null> = {};
  for (const [k, kind] of Object.entries(TEAM_FIELDS)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === "") {
      if (k === "name") return { error: "The team needs a name" };
      patch[k] = null;
      continue;
    }
    if (kind === "date") {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: `Bad date for ${FIELD_LABEL[k]}` };
      patch[k] = v;
    } else if (kind === "int") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 500) return { error: "Number of people must be 1–500" };
      patch[k] = n;
    } else {
      if (typeof v !== "string") return { error: `Bad value for ${FIELD_LABEL[k]}` };
      const t = v.trim();
      if (t.length > 4000) return { error: `${FIELD_LABEL[k]} is too long` };
      patch[k] = t || null;
    }
  }
  const a = ("arrival_on" in patch ? patch.arrival_on : current.arrival_on) as string | null;
  const d = ("departure_on" in patch ? patch.departure_on : current.departure_on) as string | null;
  if (a && d && d < a) return { error: "Departure is before arrival" };
  return { patch };
}

/** "12 Mar – 9 Apr 2027", or the rough dates while they're not fixed. */
export function teamDates(t: { arrival_on: string | null; departure_on: string | null; dates_text: string | null }): string {
  const short = (iso: string) => dayLabel(iso).slice(4);
  if (t.arrival_on && t.departure_on) return `${short(t.arrival_on)} – ${short(t.departure_on)} ${t.departure_on.slice(0, 4)}`;
  if (t.arrival_on) return `From ${short(t.arrival_on)} ${t.arrival_on.slice(0, 4)}`;
  return t.dates_text ?? "Dates not known yet";
}
