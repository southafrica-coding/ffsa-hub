// ────────────────────────────────────────────────────────────
// Phone Training tab: students and weekly check-ins (redesign 48c/48d, T3)
// ────────────────────────────────────────────────────────────
// Pure shaping for /api/mobile/training/*. Reads happen in
// src/services/training.ts with the caller's own client, so RLS (migration
// 334) decides which students, check-ins and staff-only notes come back.
// The service role is used only for names, grades and arrivals of students
// the caller could already read. The phone app depends on these shapes.
// ────────────────────────────────────────────────────────────

export const NO_STORE = { "Cache-Control": "no-store" };

export const CONTACTS = ["met", "called", "no_reach"] as const;
export const MOODS = ["hard", "okay", "good", "great"] as const;
export type Contact = (typeof CONTACTS)[number];
export type Mood = (typeof MOODS)[number];

/** Students who are at the school or on their way. */
export const ACTIVE_STATUSES = ["waiting_for_arrival", "arrived"] as const;

/** No check-in from anyone for this many days raises "no check-in" (48a/48d). */
export const OVERDUE_DAYS = 14;

/** How far back the list looks for the last check-in. */
export const LIST_WINDOW_DAYS = 8 * 7;

const NOTE_MAX = 2000;

/** YYYY-MM-DD of the Monday of `now`'s week in South Africa (UTC+2, no DST). */
export function weekOf(now: Date): string {
  const sa = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const isoDow = sa.getUTCDay() === 0 ? 7 : sa.getUTCDay();
  sa.setUTCDate(sa.getUTCDate() - (isoDow - 1));
  return sa.toISOString().slice(0, 10);
}

/** Today's date in South Africa, YYYY-MM-DD. */
export function saToday(now: Date): string {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type NameRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export function firstName(row: NameRow | undefined | null): string {
  return (row?.preferred_name || row?.first_name || "").trim() || "Someone";
}

export function personName(row: NameRow | undefined | null): string {
  if (!row) return "Unknown";
  const first = (row.preferred_name || row.first_name || "").trim();
  const last = (row.last_name || "").trim();
  return [first, last].filter(Boolean).join(" ") || "Unknown";
}

// ── Students list ───────────────────────────────────────────

export type StudentStatus = "needs_care" | "no_checkin" | "on_track" | "arriving";

const STATUS_ORDER: Record<StudentStatus, number> = { needs_care: 0, no_checkin: 1, on_track: 2, arriving: 3 };

export function studentStatus(input: {
  enrollmentStatus: string;
  lastWeekOf: string | null;
  openCare: boolean;
  today: string;
}): StudentStatus {
  if (input.openCare) return "needs_care";
  if (input.enrollmentStatus !== "arrived") return "arriving";
  if (!input.lastWeekOf) return "no_checkin";
  return daysBetween(input.lastWeekOf, input.today) >= OVERDUE_DAYS ? "no_checkin" : "on_track";
}

export type EnrolmentRow = {
  id: string;
  user_id: string;
  program_id: string;
  status: string;
  enrolled_at: string | null;
  programs: { name: string | null; code: string | null } | Array<{ name: string | null; code: string | null }> | null;
};

export type WalkerRow = { enrollment_id: string; user_id: string };

export type CheckinRow = {
  id: string;
  enrollment_id: string;
  week_of: string;
  by_user_id: string;
  contact: Contact;
  mood: Mood | null;
  note_for_student: string | null;
  needs_care: boolean;
  care_taken_by: string | null;
  care_taken_at: string | null;
  created_at: string;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export type StudentListItem = {
  enrollmentId: string;
  name: string;
  programId: string;
  programName: string;
  enrollmentStatus: string;
  status: StudentStatus;
  lastCheckin: { weekOf: string; contact: Contact; mood: Mood | null; daysAgo: number } | null;
  walkers: Array<{ userId: string; name: string }>;
  walkingWithMe: boolean;
};

export function shapeStudents(input: {
  me: string;
  today: string;
  enrolments: EnrolmentRow[];
  walkers: WalkerRow[];
  checkins: CheckinRow[];
  names: Map<string, NameRow>;
}): StudentListItem[] {
  const out = input.enrolments.map((e) => {
    const mine = input.checkins
      .filter((c) => c.enrollment_id === e.id)
      .sort((a, b) => (a.week_of < b.week_of ? 1 : a.week_of > b.week_of ? -1 : b.created_at.localeCompare(a.created_at)));
    const last = mine[0] ?? null;
    const openCare = mine.some((c) => c.needs_care && !c.care_taken_at);
    const walkers = input.walkers
      .filter((w) => w.enrollment_id === e.id)
      .map((w) => ({ userId: w.user_id, name: personName(input.names.get(w.user_id)) }));
    return {
      enrollmentId: e.id,
      name: personName(input.names.get(e.user_id)),
      programId: e.program_id,
      programName: one(e.programs)?.name ?? "",
      enrollmentStatus: e.status,
      status: studentStatus({ enrollmentStatus: e.status, lastWeekOf: last?.week_of ?? null, openCare, today: input.today }),
      lastCheckin: last
        ? { weekOf: last.week_of, contact: last.contact, mood: last.mood, daysAgo: daysBetween(last.week_of, input.today) }
        : null,
      walkers,
      walkingWithMe: walkers.some((w) => w.userId === input.me),
    };
  });
  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

// ── One student ─────────────────────────────────────────────

export type JourneyItem = { at: string; kind: string; title: string; detail: string | null };

const MOOD_WORD: Record<Mood, string> = { hard: "hard", okay: "okay", good: "good", great: "great" };
const CONTACT_WORD: Record<Contact, string> = { met: "Met", called: "Called", no_reach: "Couldn't reach" };

/**
 * The student's journey (48c), newest first, built only from school tables.
 * Never includes note text: notes live on the Check-ins tab, under RLS.
 */
export function buildJourney(input: {
  enrolledAt: string | null;
  arrivals: Array<{ status: string; marked_at: string; course: string | null }>;
  grades: Array<{ letter_grade: string | null; graded_at: string | null; course: string | null }>;
  checkins: CheckinRow[];
  names: Map<string, NameRow>;
}): JourneyItem[] {
  const items: JourneyItem[] = [];
  if (input.enrolledAt) items.push({ at: input.enrolledAt, kind: "enrolled", title: "Enrolled", detail: null });
  for (const a of input.arrivals) {
    items.push({
      at: a.marked_at,
      kind: a.status === "arrived" ? "arrived" : "no_show",
      title: a.status === "arrived" ? "Arrived" : "Didn't arrive",
      detail: a.course,
    });
  }
  for (const g of input.grades) {
    if (!g.letter_grade || !g.graded_at) continue;
    items.push({ at: g.graded_at, kind: "graded", title: `Graded · ${g.course ?? "course"} · ${g.letter_grade}`, detail: null });
  }
  for (const c of input.checkins) {
    const who = firstName(input.names.get(c.by_user_id));
    items.push({
      at: c.created_at,
      kind: "checkin",
      title: c.mood ? `Check-in · ${MOOD_WORD[c.mood]}` : "Check-in",
      detail: `${CONTACT_WORD[c.contact]} · ${who}`,
    });
    if (c.needs_care) items.push({ at: c.created_at, kind: "needs_care", title: "Flagged · needs care", detail: `by ${who}` });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

// ── Saving a check-in ───────────────────────────────────────

export type CheckinInput = {
  enrollmentId: string;
  contact: Contact;
  mood: Mood | null;
  noteForStudent: string | null;
  noteStaffOnly: string | null;
  needsCare: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

function note(v: unknown): string | null | false {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (t.length > NOTE_MAX) return false;
  return t || null;
}

export function parseCheckinBody(body: unknown): { ok: true; value: CheckinInput } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.enrollmentId)) return { ok: false, message: "Which student is this check-in for?" };
  if (!CONTACTS.includes(b.contact as Contact)) return { ok: false, message: "Say whether you met, called or couldn't reach them." };
  const contact = b.contact as Contact;
  let mood: Mood | null = null;
  if (contact !== "no_reach") {
    if (!MOODS.includes(b.mood as Mood)) return { ok: false, message: "Pick how they are: hard, okay, good or great." };
    mood = b.mood as Mood;
  }
  const forStudent = note(b.noteForStudent);
  const staffOnly = note(b.noteStaffOnly);
  if (forStudent === false || staffOnly === false) return { ok: false, message: `Notes can be up to ${NOTE_MAX} characters.` };
  return {
    ok: true,
    value: { enrollmentId: b.enrollmentId, contact, mood, noteForStudent: forStudent, noteStaffOnly: staffOnly, needsCare: b.needsCare === true },
  };
}
