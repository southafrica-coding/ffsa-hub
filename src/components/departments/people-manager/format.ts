// Words and dates for the People Manager UI. Calendar dates (YYYY-MM-DD) are
// read in UTC so a day never shifts; timestamps are shown in South African
// time. Leave counts weekdays only; public holidays are never leave.

import { addDays, weekdayOf } from "@/lib/people-manager/days";
import type { LeaveStatus, PmAwayRow, PmGoesTo, PmHoliday, PmPreview, PmProjection, PmRequest } from "./types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) - 1, d: Number(iso.slice(8, 10)) });

/** "Thu 10 Dec" */
export function dayLabel(iso: string, withYear = false): string {
  const { y, m, d } = parts(iso);
  return `${DOW[weekdayOf(iso)]} ${d} ${MONTHS[m]}${withYear ? ` ${y}` : ""}`;
}

/** "Thu 10 – Fri 18 Dec", "Thu 26 Nov – Tue 1 Dec", "Wed 30 Dec 2026 – Fri 8 Jan 2027", "Fri 20 Nov". */
export function rangeLabel(start: string, end: string): string {
  if (start === end) return dayLabel(start);
  const a = parts(start);
  const b = parts(end);
  if (a.y !== b.y) return `${dayLabel(start, true)} – ${dayLabel(end, true)}`;
  if (a.m === b.m) return `${DOW[weekdayOf(start)]} ${a.d} – ${dayLabel(end)}`;
  return `${dayLabel(start)} – ${dayLabel(end)}`;
}

/** "14–18 Dec" (compact, for lists). */
export function shortRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m]}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m]}`;
  return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]}`;
}

export function monthTitle(year: number, month: number): string {
  return `${MONTHS_LONG[month]} ${year}`;
}

export function monthInitial(month: number): string {
  return MONTHS_LONG[month].charAt(0);
}

/** "23 NOV" for the timeline's week heads. */
export function weekHead(iso: string): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m].toUpperCase()}`;
}

/** "26 Nov" for an instant, in South African time. */
export function shortDate(stamp: string | null | undefined): string {
  if (!stamp) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" }).format(date);
}

/** 7 → "7", 6.5 → "6.5". */
export function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function weekdayUnit(n: number): string {
  return n === 1 ? "weekday" : "weekdays";
}

export function statusLabel(status: LeaveStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
  }
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Someone";
}

/** "Ben O." for the timeline. */
export function shortName(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "Someone";
  return words.length > 1 ? `${words[0]} ${words[words.length - 1][0]}.` : words[0];
}

/** "Annual leave" → "Annual", "Family responsibility" → "Family". */
export function shortTypeLabel(label: string | null | undefined): string {
  return (label ?? "Leave").trim().split(/\s+/)[0] || "Leave";
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[], conj = "and"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${conj} ${names[names.length - 1]}`;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}

/** Monday on or before the day. */
export function mondayOf(iso: string): string {
  const w = weekdayOf(iso);
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

export function isWeekend(iso: string): boolean {
  const w = weekdayOf(iso);
  return w === 0 || w === 6;
}

// ── the live preview ───────────────────────────────────────

/** "9 calendar days. Sat 12 and Sun 13 aren't counted." */
export function calendarCopy(preview: Pick<PmPreview, "calendar_days" | "weekend_days" | "holidays">): string {
  const cal = `${preview.calendar_days} calendar day${preview.calendar_days === 1 ? "" : "s"}.`;
  const skipped = [...preview.weekend_days, ...preview.holidays.map((h) => h.day)].sort();
  if (!skipped.length) return cal;
  if (skipped.length <= 4) {
    const verb = skipped.length === 1 ? "isn't" : "aren't";
    return `${cal} ${joinNames(skipped.map((d) => dayLabel(d).replace(/ [A-Z][a-z]{2}$/, "")))} ${verb} counted.`;
  }
  return `${cal} ${skipped.length} weekend and holiday days aren't counted.`;
}

/**
 * The public holiday flag. A weekday holiday is part of the calendar span
 * but is never counted as leave.
 */
export function holidayCopy(holidays: readonly PmHoliday[]): string | null {
  if (!holidays.length) return null;
  const list = joinNames(holidays.map((h) => `${dayLabel(h.day)} (${h.name})`));
  return holidays.length === 1
    ? `Includes ${list}. It's inside your dates but isn't counted as leave.`
    : `Includes ${list}. They're inside your dates but aren't counted as leave.`;
}

/** The line under the usage bar on the form. Guidelines are guidance only. */
export function projectionCopy(p: Pick<PmProjection, "total" | "guideline" | "over" | "used" | "this_request">): string {
  if (p.guideline === null) return "There's no yearly guideline for this type. It's still counted and your leader sees the total.";
  const over = p.over ?? 0;
  if (over > 0) return `This goes ${fmtDays(over)} over the guideline. You can still ask; your leader sees the totals.`;
  if (p.total === p.guideline) return "This takes you to the guideline exactly. You can still ask for more; your leader sees the totals.";
  const left = p.guideline - p.total;
  return `${fmtDays(left)} ${left === 1 ? "day" : "days"} left in the guideline after this.`;
}

/** "Mia Fourie · away 14–18 Dec (pending)" for also-away lists. */
export function awayLine(row: PmAwayRow): string {
  const who = row.name ?? "Someone";
  const when = shortRange(row.start_date, row.end_date);
  if (row.source === "blockout") return `${who} · unavailable ${when}`;
  return `${who} · away ${when}${row.status === "pending" ? " (pending)" : ""}`;
}

export function goesToWords(goes: PmGoesTo | null | undefined, departmentName: string): { lead: string; names: string[]; tail: string } {
  const names = (goes?.people ?? []).map((p) => p.name);
  if (!goes || goes.via === "admin" || !names.length) {
    return { lead: `A Hub admin, because there's no other ${departmentName} leader to ask.`, names: [], tail: " You'll get a Slack DM." };
  }
  if (names.length === 1) return { lead: `A ${departmentName} leader: `, names, tail: ". You'll get a Slack DM." };
  return { lead: `Any ${departmentName} leader: `, names, tail: ". One decision is enough. You'll get a Slack DM." };
}

/** Grey line under a request: who decided and when, who it went to, or who cancelled. */
export function requestMeta(r: PmRequest, mine: boolean): string {
  const covered = r.covering?.name ? ` · covered by ${r.covering.name}` : r.covering_note ? ` · cover: ${r.covering_note}` : "";
  switch (r.status) {
    case "pending": {
      const to = r.sent_to.map((s) => firstName(s.name)).filter((n) => n !== "Someone");
      const sent = `sent ${shortDate(r.created_at)}`;
      return `${sent}${to.length ? ` to ${joinNames(to)}` : ""}${covered}`;
    }
    case "approved":
    case "declined":
      return `${r.decided_by_person?.name ?? "A leader"}${r.decided_at ? ` · ${shortDate(r.decided_at)}` : ""}${r.status === "approved" ? covered : ""}`;
    case "cancelled":
      return `${mine ? "you cancelled" : "cancelled"}${r.cancelled_at ? ` on ${shortDate(r.cancelled_at)}` : ""}`;
  }
}

/**
 * Subtitle for a block-out reason. Null means hide the line.
 * After #758, `reason` is null for everyone except the owner and admins.
 * A leader looking at someone else's row must not see "No reason given"
 * for a redacted reason. That copy is only for the owner's own empty reason.
 */
export function blockoutReasonLabel(reason: string | null | undefined, own: boolean): string | null {
  const text = (reason ?? "").trim();
  if (text) return text;
  return own ? "No reason given" : null;
}
