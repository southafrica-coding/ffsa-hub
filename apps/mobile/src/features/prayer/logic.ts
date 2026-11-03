// Pure logic for the Prayer Room: week maths, the wall's rules (lead seats,
// curated bands), seat counts, what's mine, spoken sentences, the permission
// gate and friendly errors. No React, no I/O: unit-tested on its own.
//
// Time zone. Set dates and times are stored as the room's wall clock
// ("2026-11-03", "19:00"), so they are shown exactly as stored and never
// converted. Only "today" needs a clock, and the room is in South Africa:
// SAST is UTC+2 all year (no daylight saving), so a fixed offset is exact and
// doesn't depend on the phone's own time zone.

import type { Me } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { hasRole } from "@/features/shell/access";

import { ServerMessageError } from "./server-message";
import type { Band, Blockout, Person, PrayerSet, SeatType, Slot } from "./api";
import { strings } from "./strings";

// ── Clock and dates (SAST, date-only strings, no local-time drift) ──────────

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** SAST wall clock "YYYY-MM-DDTHH:MM", whatever zone the phone is in. */
export function sastNow(at: Date = new Date()): string {
  return new Date(at.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 16);
}

export function sastToday(at: Date = new Date()): string {
  return sastNow(at).slice(0, 10);
}

export function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Sunday that starts the week containing `iso` (the room's convention, as the DB). */
export function weekStart(iso: string): string {
  return shiftDays(iso, -weekdayOf(iso));
}

/** Sun → Sat of the week containing `iso`: the range the web fetches. */
export function weekDays(iso: string): string[] {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => shiftDays(start, i));
}

const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(iso: string) {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}

/** "1–7 Nov 2026" or "29 Nov – 5 Dec 2026", like the web's week label. */
export function weekRangeLabel(iso: string): string {
  const days = weekDays(iso);
  const a = parts(days[0]);
  const b = parts(days[6]);
  if (a.m === b.m) return `${a.d}–${b.d} ${MON_SHORT[b.m - 1]} ${b.y}`;
  return `${a.d} ${MON_SHORT[a.m - 1]} – ${b.d} ${MON_SHORT[b.m - 1]} ${b.y}`;
}

/** "Mon 3 Nov" */
export function dayLabel(iso: string): string {
  const p = parts(iso);
  return `${WD_SHORT[weekdayOf(iso)]} ${p.d} ${MON_SHORT[p.m - 1]}`;
}

/** "Monday 3 November", for screen readers. */
export function spokenDate(iso: string): string {
  const p = parts(iso);
  return `${WD_LONG[weekdayOf(iso)]} ${p.d} ${MON_LONG[p.m - 1]}`;
}

export function weekdayName(iso: string): string {
  return WD_LONG[weekdayOf(iso)];
}

// ── Times ───────────────────────────────────────────────────────────────────

/** Minutes since midnight from "HH:MM[:SS]". */
export function toMin(t: string | null | undefined): number {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** "06:00–08:00", 24-hour like the web. */
export function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** "2H", "45MIN", "1H 30MIN" — the web drawer's duration. */
export function durationLabel(start: string, end: string): string {
  const mins = Math.max(0, toMin(end) - toMin(start));
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h === 0 ? `${r}MIN` : r === 0 ? `${h}H` : `${h}H ${r}MIN`;
}

function spokenClock(mins: number): { text: string; meridiem: "am" | "pm" | null } {
  const m = ((mins % 1440) + 1440) % 1440;
  if (m === 0) return { text: "midnight", meridiem: null };
  if (m === 720) return { text: "noon", meridiem: null };
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: min === 0 ? `${h12}` : `${h12}:${String(min).padStart(2, "0")}`, meridiem: h24 < 12 ? "am" : "pm" };
}

/** "7 to 9 pm", "11:30 am to 1 pm", "10 pm to midnight". */
export function spokenTimeRange(start: string, end: string): string {
  const a = spokenClock(toMin(start));
  const b = spokenClock(toMin(end));
  const left = a.meridiem && a.meridiem !== b.meridiem ? `${a.text} ${a.meridiem}` : a.text;
  const right = b.meridiem ? `${b.text} ${b.meridiem}` : b.text;
  return `${left} to ${right}`;
}

// ── People ──────────────────────────────────────────────────────────────────

/** First name, as the web's wall and lineup show it. */
export function displayName(p: Person): string {
  return p?.first_name || "Someone";
}

export function fullName(p: Person): string {
  if (!p) return "Someone";
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || "Someone";
}

// ── The wall's rules ────────────────────────────────────────────────────────

export function setTitle(s: { title: string | null; theme: string | null }): string {
  return s.title || s.theme || strings.set.devo;
}

const LEGACY_LEADS = ["prayer_leader", "worship_leader"];
const LEGACY_LABELS: Record<string, string> = {
  worship_leader: "Worship Lead",
  prayer_leader: "Prayer Lead",
  vocals: "Vocals",
  instrument: "Instrument",
};

type SeatRef = { seat_type_id?: string | null; role: string };

const seatKey = (s: SeatRef) => s.seat_type_id ?? s.role;

/** The lead seat ids; the two legacy lead roles if the seat list hasn't arrived. */
export function leadSeatIds(seatTypes: SeatType[]): Set<string> {
  return new Set(seatTypes.length ? seatTypes.filter((s) => s.is_lead).map((s) => s.id) : LEGACY_LEADS);
}

export function isLeadSlot(slot: Slot, leads: Set<string>): boolean {
  return leads.has(seatKey(slot));
}

export function seatLabel(slot: SeatRef, seatTypes: SeatType[]): string {
  const key = seatKey(slot);
  return seatTypes.find((s) => s.id === key)?.label ?? LEGACY_LABELS[key] ?? (key.replace(/_/g, " ") || "Seat");
}

/** A set is LIVE once a lead seat is filled. Until then it holds its slot but isn't live. */
export function needsALead(set: PrayerSet, seatTypes: SeatType[]): boolean {
  const leads = leadSeatIds(seatTypes);
  return !set.slots.some((s) => s.status === "filled" && isLeadSlot(s, leads));
}

/** First names in the filled lead seats: "Thabo & Grace". */
export function leadNames(set: PrayerSet, seatTypes: SeatType[]): string | null {
  const leads = leadSeatIds(seatTypes);
  const names = set.slots.filter((s) => s.status === "filled" && isLeadSlot(s, leads)).map((s) => displayName(s.filled));
  return names.length ? names.join(" & ") : null;
}

/** Curated band (MORNING / NOON / NIGHT) the set's time falls in, if any. Same rule as the web. */
export function bandFor(set: Pick<PrayerSet, "start_time" | "end_time">, bands: Band[]): string | null {
  const s = toMin(set.start_time);
  const e = toMin(set.end_time);
  return bands.find((b) => b.band_name && toMin(b.start_time) < e && toMin(b.end_time) > s)?.band_name ?? null;
}

export type SeatCounts = { taken: number; open: number; total: number };

/** taken = filled; open = open or declined (the web's "seats open"); invited is neither. */
export function seatCounts(set: Pick<PrayerSet, "slots">): SeatCounts {
  return {
    taken: set.slots.filter((s) => s.status === "filled").length,
    open: set.slots.filter((s) => s.status === "open" || s.status === "declined").length,
    total: set.slots.length,
  };
}

/** Lead seats first, then the seat vocabulary's order (the web lineup's two blocks). */
export function lineup(set: PrayerSet, seatTypes: SeatType[]): { leads: Slot[]; others: Slot[] } {
  const leads = leadSeatIds(seatTypes);
  const order = (s: Slot) => seatTypes.find((t) => t.id === seatKey(s))?.sort_order ?? 99;
  const sorted = [...set.slots].sort((a, b) => order(a) - order(b));
  return { leads: sorted.filter((s) => isLeadSlot(s, leads)), others: sorted.filter((s) => !isLeadSlot(s, leads)) };
}

export type Relation = "serving" | "invited" | "owner" | null;

/** How I'm connected to a set, strongest first. */
export function myRelation(set: PrayerSet, userId: string | null): Relation {
  if (!userId) return null;
  if (set.slots.some((s) => s.status === "filled" && s.filled_user_id === userId)) return "serving";
  if (set.slots.some((s) => s.status === "invited" && s.invitee_id === userId)) return "invited";
  if (set.owner_id === userId) return "owner";
  return null;
}

export function isOpenSeat(slot: Slot): boolean {
  return slot.status === "open" || slot.status === "declined";
}

/** Sets that count: cancelled ones never draw (the API already hides them). */
export function liveSets(sets: PrayerSet[]): PrayerSet[] {
  return sets.filter((s) => s.status !== "cancelled");
}

export type DayGroup = { date: string; sets: PrayerSet[]; blockouts: Blockout[] };

/**
 * The week as a vertical run of days (frame 11b). Monday to Friday always
 * appear, like the wall; Saturday and Sunday only when something is on them.
 */
export function groupWeek(anchor: string, sets: PrayerSet[], blockouts: Blockout[]): DayGroup[] {
  const sorted = [...liveSets(sets)].sort(
    (a, b) => a.set_date.localeCompare(b.set_date) || a.start_time.localeCompare(b.start_time),
  );
  return weekDays(anchor)
    .map((date) => ({
      date,
      sets: sorted.filter((s) => s.set_date === date),
      blockouts: blockouts.filter((b) => b.block_date <= date && (b.end_date && b.end_date > b.block_date ? b.end_date : b.block_date) >= date),
    }))
    .filter((g) => {
      const dow = weekdayOf(g.date);
      return (dow >= 1 && dow <= 5) || g.sets.length > 0;
    });
}

export function weekSummary(sets: PrayerSet[]): { sets: number; open: number; seats: number } {
  const live = liveSets(sets);
  const seats = live.flatMap((s) => s.slots);
  return { sets: live.length, open: seats.filter(isOpenSeat).length, seats: seats.length };
}

export function blockoutWhen(b: Blockout): string {
  return b.start_time && b.end_time ? timeRange(b.start_time, b.end_time) : strings.week.allDay;
}

// ── Spoken sentences (VoiceOver / TalkBack read a set as one sentence) ──────

/** "Tuesday 7 to 9 pm, Night watch, 2 of 4 seats taken, you are on this set" */
export function setSentence(set: PrayerSet, seatTypes: SeatType[], bands: Band[], userId: string | null): string {
  const c = seatCounts(set);
  const bits = [`${weekdayName(set.set_date)} ${spokenTimeRange(set.start_time, set.end_time)}`, setTitle(set)];
  const band = bandFor(set, bands);
  if (band) bits.push(`${band} band`);
  bits.push(c.total === 0 ? "no seats yet" : `${c.taken} of ${c.total} ${c.total === 1 ? "seat" : "seats"} taken`);
  if (needsALead(set, seatTypes)) bits.push("needs a lead");
  if (set.relocation_note) bits.push(`moved to ${set.relocation_note}`);
  const rel = myRelation(set, userId);
  if (rel === "serving") bits.push("you are on this set");
  else if (rel === "invited") bits.push("you're invited to a seat");
  else if (rel === "owner") bits.push("you set this up");
  return bits.join(", ");
}

// ── Who may do what (UX only: the API and RLS decide) ───────────────────────

const STAFF_ROLES = ["super_admin", "admin", "prayer_room_admin"];

export type PrayerAccess = { isStaff: boolean; isEvaluator: boolean; showEvaluatorTools: boolean };

/**
 * Mirrors the web's gates (src/lib/auth/prayer-room-access.ts):
 *   staff     = super_admin / admin / prayer_room_admin role, or a DIRECT
 *               prayer_room.manage permission (the web reads user_permissions)
 *   evaluator = prayer_room.evaluate, direct or via a role
 * The web shows its Evaluators tab to evaluators and staff.
 */
export function prayerAccess(me: Me | null): PrayerAccess {
  if (!me) return { isStaff: false, isEvaluator: false, showEvaluatorTools: false };
  const isStaff =
    STAFF_ROLES.some((r) => hasRole(me, r)) ||
    me.permissions.some((p) => p.key === "prayer_room.manage" && p.source !== "role");
  const isEvaluator = me.permissions.some((p) => p.key === "prayer_room.evaluate");
  return { isStaff, isEvaluator, showEvaluatorTools: isStaff || isEvaluator };
}

/** Owner or staff manage a set's lineup (web: canManage). */
export function canManageSet(set: Pick<PrayerSet, "owner_id">, userId: string | null, access: PrayerAccess): boolean {
  return access.isStaff || (!!userId && set.owner_id === userId);
}

// ── Errors in the room's words ──────────────────────────────────────────────

/**
 * The server's sentence when it's written for people; a plain one when it's a
 * raw database message. The database is the judge of clashes, so its verdict
 * is what we show, translated where it only carries a constraint name.
 */
export function friendlyServerMessage(msg: string): string {
  if (/PGRST116|JSON object requested|0 rows|no rows/i.test(msg)) return strings.errors.seatTaken;
  if (/23P01|exclusion constraint|no_double_booking/i.test(msg)) return strings.errors.clash;
  if (/violates|constraint|relation |column |syntax|PGRST|uuid/i.test(msg)) return strings.errors.actionFailed;
  return msg;
}

export function friendlyError(err: unknown): string {
  if (err instanceof ServerMessageError) return friendlyServerMessage(err.serverMessage);
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "timeout") return err.message;
    if (err.kind === "forbidden") return strings.errors.forbiddenBody;
  }
  return strings.errors.actionFailed;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "forbidden";
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === "network" || err.kind === "timeout");
}

export function isSignedOutError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === "unauthenticated" || err.kind === "deactivated");
}

/** "Today 14:05", "Mon 2 Nov 14:05" for "saved at" lines, in SAST. */
export function savedAtLabel(savedAt: string, now: Date = new Date()): string {
  const at = sastNow(new Date(savedAt));
  const day = at.slice(0, 10) === sastToday(now) ? "today" : dayLabel(at.slice(0, 10));
  return `${day} at ${at.slice(11, 16)}`;
}
