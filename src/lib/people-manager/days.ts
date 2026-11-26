// Counting leave days, the same rule as migration 421's leave_days_by_year:
//   * only Monday to Friday count;
//   * SA public holidays never count: the rule-based ones (lib/vehicles/
//     sa-holidays, the TS twin of 365's sa_public_holiday) plus the one-off
//     days in leave_declared_holidays;
//   * a half day counts 0.5: a multi-day request may start 'pm' (off from
//     the afternoon) and end 'am' (off until lunch); a one-day request uses
//     the same part on both ends ('full', 'am' or 'pm');
//   * the leave year is the calendar year, so a range over 31 Dec / 1 Jan is
//     split by year (days_by_year), e.g. { "2026": 3, "2027": 2.5 }.
//
// 421's insert trigger computes days_count / days_by_year itself and that is
// what is stored. This copy is for the live preview on the form and the
// early "no working days" answer; days.test.ts pins it to the same cases.

import { easterSunday, isSaPublicHoliday } from "@/lib/vehicles/sa-holidays";
import type { LeaveDayPart } from "./db.types";

/** 421 refuses ranges more than 730 days apart. */
export const LEAVE_MAX_RANGE_DAYS = 730;

export type DeclaredHoliday = { day: string; name: string };

export type LeaveDayCount = {
  /** Counted days (weekdays, holidays skipped, halves 0.5). */
  days: number;
  /** Counted days per calendar year. Years with 0 counted days are left out, like 421. */
  by_year: Record<string, number>;
  /** Every date in the range, weekends included. */
  calendar_days: number;
  /** Saturdays and Sundays in the range. */
  weekend_days: string[];
  /** Weekday public holidays in the range (not counted). */
  holidays: DeclaredHoliday[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** The parts check from 421 (leave_requests_parts_check). */
export function partsFit(start: string, end: string, startPart: LeaveDayPart, endPart: LeaveDayPart): boolean {
  if (start === end) return startPart === endPart;
  if (start > end) return false;
  return (startPart === "full" || startPart === "pm") && (endPart === "full" || endPart === "am");
}

const FIXED_NAMES: Record<string, string> = {
  "01-01": "New Year's Day",
  "03-21": "Human Rights Day",
  "04-27": "Freedom Day",
  "05-01": "Workers' Day",
  "06-16": "Youth Day",
  "08-09": "National Women's Day",
  "09-24": "Heritage Day",
  "12-16": "Day of Reconciliation",
  "12-25": "Christmas Day",
  "12-26": "Day of Goodwill",
};

/** A display name for a rule-based SA public holiday, or null if the day is not one. */
export function saHolidayName(iso: string): string | null {
  if (!isSaPublicHoliday(iso)) return null;
  const fixed = FIXED_NAMES[iso.slice(5)];
  if (fixed) return fixed;
  const easter = easterSunday(Number(iso.slice(0, 4)));
  if (iso === addDays(easter, -2)) return "Good Friday";
  if (iso === addDays(easter, 1)) return "Family Day";
  const sunday = FIXED_NAMES[addDays(iso, -1).slice(5)];
  return sunday ? `${sunday} (observed)` : "Public holiday";
}

/**
 * Counted days for a range. Throws RangeError on a range 421 would refuse
 * (leave_days_bad_range); callers validate first.
 */
export function countLeaveDays(input: {
  start: string;
  end: string;
  startPart?: LeaveDayPart;
  endPart?: LeaveDayPart;
  declared?: readonly DeclaredHoliday[];
}): LeaveDayCount {
  const startPart = input.startPart ?? "full";
  const endPart = input.endPart ?? "full";
  const { start, end } = input;
  if (!isIsoDate(start) || !isIsoDate(end) || end < start || daysBetween(start, end) > LEAVE_MAX_RANGE_DAYS) {
    throw new RangeError("leave_days_bad_range");
  }
  if (!partsFit(start, end, startPart, endPart)) throw new RangeError("leave_days_bad_range");

  const declared = new Map((input.declared ?? []).map((h) => [h.day, h.name]));
  const byYear: Record<string, number> = {};
  const weekend: string[] = [];
  const holidays: DeclaredHoliday[] = [];
  let calendar = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    calendar += 1;
    const w = weekdayOf(d);
    if (w === 0 || w === 6) {
      weekend.push(d);
      continue;
    }
    const holiday = saHolidayName(d) ?? declared.get(d) ?? null;
    if (holiday) {
      holidays.push({ day: d, name: holiday });
      continue;
    }
    const half = (d === start && startPart !== "full") || (d === end && endPart !== "full");
    const year = d.slice(0, 4);
    byYear[year] = (byYear[year] ?? 0) + (half ? 0.5 : 1);
  }
  const days = Object.values(byYear).reduce((a, b) => a + b, 0);
  return { days, by_year: byYear, calendar_days: calendar, weekend_days: weekend, holidays };
}

/** Days of a stored request that fall in one leave year (from 421's days_by_year). */
export function daysInYear(byYear: Record<string, number> | null | undefined, year: number): number {
  const v = byYear?.[String(year)];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}
