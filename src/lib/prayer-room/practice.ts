/**
 * Prayer room PRACTICE — shared shapes and pure helpers (handoff 17, turn 36).
 *
 * The rules themselves live in the database (migration 224): exclusion
 * constraints for clashes, a trigger for the window / step / length / opening,
 * and functions for the multi-row writes. Everything here only DESCRIBES what
 * the database will do, so the wall and the drawers can grey things out and
 * say why before anyone presses a button. If the two ever disagree, the
 * database wins and the route passes its message through.
 *
 * Practice is never coverage: none of this touches prayer_room_sets.
 */

export type PracticeSettings = {
  start_time: string;
  end_time: string;
  slot_minutes: number;
  /** 0 = Sunday … 6 = Saturday. Weekends are always closed on top of these. */
  closed_weekdays: number[];
  closed_label: string;
  max_minutes: number;
  opens_weekday: number;
  opens_time: string;
};

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  start_time: "16:00",
  end_time: "17:30",
  slot_minutes: 30,
  closed_weekdays: [2],
  closed_label: "Ministry night",
  max_minutes: 60,
  opens_weekday: 0,
  opens_time: "00:00",
};

export type PracticeStation = {
  id: string;
  slug: string;
  label: string;
  short_label: string;
  seat_type_id: string | null;
  sort_order: number;
  max_people: number;
};

export type PracticePerson = {
  user_id: string;
  station_id: string;
  first_name: string;
  full_name: string;
};

export type PracticeBooking = {
  id: string;
  kind: "station" | "band";
  practice_date: string;
  start_time: string;
  end_time: string;
  station_id: string | null;
  booked_by: string;
  band_name: string | null;
  people: PracticePerson[];
};

export type PracticeWeek = {
  settings: PracticeSettings;
  stations: PracticeStation[];
  bookings: PracticeBooking[];
  /** Mon–Fri ISO dates of the week asked for. */
  days: string[];
  /** When the week asked for opens / opened, "YYYY-MM-DDTHH:MM" SAST. */
  opensAt: string;
  /** When the FOLLOWING week opens — 36e's "next week opens" note. */
  nextOpensAt: string;
  /** SAST wall clock right now, "YYYY-MM-DDTHH:MM". */
  now: string;
  me: {
    canBook: boolean;
    isStaff: boolean;
    /** The station matching a seat you are signed off for, if any. */
    defaultStationId: string | null;
  };
};

/**
 * globals.css sets every <button> in mono bold uppercase (!important on the
 * family and weight). Practice buttons carry names and sentences, so they opt
 * back into body type; a class out-specifies the element rule, and the mono
 * labels inside keep their own classes.
 */
export const PLAIN_BUTTON = "!font-sans !font-normal normal-case tracking-normal leading-tight";

/** Minutes since midnight from "HH:MM[:SS]". */
export function toMin(t: string | null | undefined): number {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

export function hhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/** 0 = Sunday, read from a date-only ISO string without any local-time drift. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function shiftISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Mon–Fri of the week (Sunday-start, the room's convention) containing `iso`. */
export function practiceDays(iso: string): string[] {
  const sunday = shiftISO(iso, -weekdayOf(iso));
  return [1, 2, 3, 4, 5].map((n) => shiftISO(sunday, n));
}

export function isClosedDay(settings: PracticeSettings, iso: string): boolean {
  const dow = weekdayOf(iso);
  return dow === 0 || dow === 6 || settings.closed_weekdays.includes(dow);
}

/** The rows of a practice day: 16:00, 16:30, 17:00 by default. */
export function practiceRows(settings: PracticeSettings): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const end = toMin(settings.end_time);
  for (let m = toMin(settings.start_time); m + settings.slot_minutes <= end; m += settings.slot_minutes) {
    out.push({ start: m, end: m + settings.slot_minutes });
  }
  return out;
}

/** Mirrors public.practice_opens_at(): "YYYY-MM-DDTHH:MM", SAST. */
export function opensAt(settings: PracticeSettings, iso: string): string {
  const sunday = shiftISO(iso, -weekdayOf(iso));
  const day = shiftISO(sunday, -((7 - settings.opens_weekday) % 7));
  return `${day}T${settings.opens_time.slice(0, 5)}`;
}

/** SAST wall clock, "YYYY-MM-DDTHH:MM". Vercel renders in UTC; the room is in SAST. */
export function sastNow(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "SUN 04 OCT" from "2026-10-04T00:00". */
export function shortDayLabel(isoish: string): string {
  const d = new Date(`${isoish.slice(0, 10)}T00:00:00Z`);
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
  return `${wd} ${String(d.getUTCDate()).padStart(2, "0")} ${mon}`;
}

/** What is happening in one row of one day. */
export type RowState = {
  start: number;
  end: number;
  /** A band holding this row, if any. Nothing else can be booked in it. */
  band: PracticeBooking | null;
  /** The station booking covering this row, per station id. */
  byStation: Map<string, PracticeBooking>;
  /** How many people are practising in it (a vocal group counts each singer). */
  people: number;
  /** Stations still free. 0 under a band. */
  open: number;
};

export function rowState(
  bookings: PracticeBooking[],
  stations: PracticeStation[],
  date: string,
  start: number,
  end: number
): RowState {
  const here = bookings.filter(
    (b) => b.practice_date === date && toMin(b.start_time) < end && toMin(b.end_time) > start
  );
  const band = here.find((b) => b.kind === "band") ?? null;
  const byStation = new Map<string, PracticeBooking>();
  for (const b of here) if (b.kind === "station" && b.station_id) byStation.set(b.station_id, b);
  const people = here
    .filter((b) => b.kind === "station")
    .reduce((n, b) => n + Math.max(b.people.length, 1), 0);
  return {
    start,
    end,
    band,
    byStation,
    people,
    open: band ? 0 : stations.length - byStation.size,
  };
}

/** "2 people already practising." — 36b/36c's reason a band is greyed out. */
export function practisingPhrase(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"} already practising`;
}

/** First names on a station booking: "Sample", or "Person +2" for a group. */
export function bookingNames(b: PracticeBooking): string {
  if (b.people.length === 0) return "Someone";
  const first = b.people[0].first_name;
  return b.people.length > 1 ? `${first} +${b.people.length - 1}` : first;
}

/**
 * The database's errors in the room's words. Trigger and function messages are
 * already written for people and pass through; the exclusion constraints only
 * carry their names, so those are translated here.
 */
export function practiceErrorMessage(
  err: { code?: string; message?: string } | null | undefined,
  kind: "station" | "band" = "station"
): string {
  const msg = err?.message ?? "";
  if (err?.code === "23P01" || /exclusion constraint/.test(msg)) {
    if (msg.includes("practice_station_no_overlap")) return "Someone already has that station then.";
    if (msg.includes("practice_band_no_overlap")) return "A band already has the room then.";
    if (msg.includes("practice_band_vs_station")) {
      return kind === "band"
        ? "That row isn't empty. A band can only book a row nobody is practising in, and only an admin can move people."
        : "A band has the whole room then.";
    }
    return "That time clashes with another booking.";
  }
  return msg || "Could not save that booking.";
}
