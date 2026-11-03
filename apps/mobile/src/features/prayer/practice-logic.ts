// Practice (handoff 17, migration 224): pure helpers ported from the web's
// src/lib/prayer-room/practice.ts, so the phone greys things out and says why
// exactly as the web does. They only DESCRIBE the database's rules (window,
// 30-minute steps, 60 minutes max, the Sunday opening, no clashes, bands only
// on empty rows); the database still decides, and its message is what we show
// if the two ever disagree.

import type { PracticeBooking, PracticeSettings, PracticeStation, PracticeWeek } from "./api";
import { hhmm, toMin, weekdayOf } from "./logic";
import { strings } from "./strings";

export function isClosedDay(settings: PracticeSettings, iso: string): boolean {
  const dow = weekdayOf(iso);
  return dow === 0 || dow === 6 || settings.closed_weekdays.includes(dow);
}

/** The rows of a practice day: 16:00, 16:30, 17:00 by default. */
export function practiceRows(settings: PracticeSettings): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const end = toMin(settings.end_time);
  const step = Math.max(5, settings.slot_minutes);
  for (let m = toMin(settings.start_time); m + step <= end; m += step) out.push({ start: m, end: m + step });
  return out;
}

export type RowState = {
  start: number;
  end: number;
  band: PracticeBooking | null;
  byStation: Map<string, PracticeBooking>;
  /** People practising in the row (a vocal group counts each singer). */
  people: number;
  /** Stations still free. 0 under a band. */
  open: number;
};

export function rowState(
  bookings: PracticeBooking[],
  stations: PracticeStation[],
  date: string,
  start: number,
  end: number,
): RowState {
  const here = bookings.filter((b) => b.practice_date === date && toMin(b.start_time) < end && toMin(b.end_time) > start);
  const band = here.find((b) => b.kind === "band") ?? null;
  const byStation = new Map<string, PracticeBooking>();
  for (const b of here) if (b.kind === "station" && b.station_id) byStation.set(b.station_id, b);
  const people = here.filter((b) => b.kind === "station").reduce((n, b) => n + Math.max(b.people.length, 1), 0);
  return { start, end, band, byStation, people, open: band ? 0 : stations.length - byStation.size };
}

/** "Thabo", or "Grace +2" for a group. */
export function bookingNames(b: PracticeBooking): string {
  if (b.people.length === 0) return "Someone";
  const first = b.people[0].first_name;
  return b.people.length > 1 ? `${first} +${b.people.length - 1}` : first;
}

export function isMine(b: PracticeBooking, userId: string | null): boolean {
  return !!userId && (b.booked_by === userId || b.people.some((p) => p.user_id === userId));
}

/** You may cancel your own bookings; staff may cancel anyone's (practice_cancel decides). */
export function canCancel(b: PracticeBooking, userId: string | null, week: PracticeWeek): boolean {
  return week.me.isStaff || (!!userId && b.booked_by === userId);
}

export function isPast(week: PracticeWeek, date: string, end: number): boolean {
  return `${date}T${hhmm(end)}` <= week.now;
}

export function isOpenYet(week: PracticeWeek): boolean {
  return week.now >= week.opensAt;
}

/** "Sun 2 Nov at 00:00" from "2026-11-02T00:00". */
export function opensLabel(isoish: string): string {
  const d = new Date(`${isoish.slice(0, 10)}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mon} at ${isoish.slice(11, 16) || "00:00"}`;
}

/** Why a booking can't be made right now, or null if it can. Same order as the web. */
export function blockedReason(week: PracticeWeek, date: string, end: number): string | null {
  if (!week.me.canBook) return strings.practice.cantBook;
  if (isPast(week, date, end)) return strings.practice.gone;
  if (!isOpenYet(week)) return strings.practice.notOpenYet(opensLabel(week.opensAt));
  return null;
}

/** Can this station run on into the next row? (36b: "Keys is free at 17:00 too.") */
export function longerOption(
  week: PracticeWeek,
  date: string,
  start: number,
  station: PracticeStation | null,
): { ok: boolean; note: string } {
  const { settings, stations, bookings } = week;
  const slot = settings.slot_minutes;
  if (!station) return { ok: false, note: "" };
  if (2 * slot > settings.max_minutes) return { ok: false, note: "" };
  if (start + 2 * slot > toMin(settings.end_time)) return { ok: false, note: strings.practice.endsAt(settings.end_time) };
  const next = rowState(bookings, stations, date, start + slot, start + 2 * slot);
  if (next.band) return { ok: false, note: strings.practice.bandNext(hhmm(start + slot)) };
  if (next.byStation.has(station.id)) return { ok: false, note: strings.practice.takenNext(station.label, hhmm(start + slot)) };
  return { ok: true, note: strings.practice.longerNote(station.label) };
}

/** The station to pre-select: the one tapped, else your instrument, else the first free one. */
export function preferredStation(week: PracticeWeek, row: RowState, tapped?: string | null): string | null {
  const free = (id: string | null | undefined) => !!id && !row.byStation.has(id) && week.stations.some((s) => s.id === id);
  if (free(tapped)) return tapped!;
  if (free(week.me.defaultStationId)) return week.me.defaultStationId;
  return week.stations.find((s) => !row.byStation.has(s.id))?.id ?? null;
}

/** My bookings this week, soonest first. */
export function myPracticeBookings(week: PracticeWeek, userId: string | null): PracticeBooking[] {
  return week.bookings
    .filter((b) => isMine(b, userId))
    .sort((a, b) => a.practice_date.localeCompare(b.practice_date) || a.start_time.localeCompare(b.start_time));
}

export function stationName(week: PracticeWeek, b: PracticeBooking): string {
  if (b.kind === "band") return strings.practice.band(b.band_name ?? "");
  return week.stations.find((s) => s.id === b.station_id)?.label ?? "Station";
}
