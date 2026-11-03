// Pure helpers for My Schools and My Attendance (unit-tested in
// __tests__/logic.test.ts). The grade maths mirrors the website's
// src/services/schools.ts (gradeToPoints / calculateGPA) and its
// /my-schools/[enrollmentId] page, so the phone and the web agree.

import { hasRole, isAdmin } from "@/features/shell/access";
import type { Me } from "@/lib/api";

import type { Application, AttendanceRecord, Course, Grade, Programme, Staff } from "./types";

// ── Status words (never colour alone) ───────────────────────────────────────

export type Tone = "positive" | "attention" | "danger" | "default";

const ENROLMENT: Record<string, { label: string; tone: Tone }> = {
  arrived: { label: "Arrived", tone: "positive" },
  active: { label: "Active", tone: "positive" },
  waiting_for_arrival: { label: "Waiting for arrival", tone: "attention" },
  on_hold: { label: "On hold", tone: "attention" },
  graduated: { label: "Graduated", tone: "default" },
  completed: { label: "Completed", tone: "default" },
  decided_to_leave: { label: "Decided to leave", tone: "default" },
  dismissed: { label: "Dismissed", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "danger" },
};

const APPLICATION: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Submitted", tone: "attention" },
  waiting_for_references: { label: "Awaiting references", tone: "attention" },
  references_received: { label: "References received", tone: "attention" },
  interview_scheduled: { label: "Interview scheduled", tone: "attention" },
  accepted: { label: "Accepted", tone: "positive" },
  rejected: { label: "Not accepted", tone: "danger" },
  waitlisted: { label: "Waitlisted", tone: "default" },
  cancelled: { label: "Cancelled", tone: "default" },
};

const ATTENDANCE: Record<string, { label: string; tone: Tone }> = {
  present: { label: "Present", tone: "positive" },
  late: { label: "Late", tone: "attention" },
  excused: { label: "Excused", tone: "default" },
  absent: { label: "Absent", tone: "danger" },
};

/** "decided_to_leave" -> "Decided to leave" (for statuses the app doesn't know yet). */
export function humanise(status: string): string {
  const words = status.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : status;
}

function lookup(table: Record<string, { label: string; tone: Tone }>, status: string) {
  return table[status] ?? { label: humanise(status), tone: "default" as Tone };
}

export const enrolmentStatus = (s: string) => lookup(ENROLMENT, s);
export const applicationStatus = (s: string) => lookup(APPLICATION, s);
export const attendanceStatus = (s: string) => lookup(ATTENDANCE, s);

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The calendar day of a date or timestamp, or null. "2026-11-03T…" -> {y,m,d}. */
function parts(iso: string | null): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** "2027-01-12" -> "12 Jan 2027"; null when missing or unreadable. */
export function formatDate(iso: string | null): string | null {
  const p = parts(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : null;
}

/** For the date block on attendance rows: { day: "03", mon: "NOV" }. */
export function dayAndMonth(iso: string | null): { day: string; mon: string } | null {
  const p = parts(iso);
  return p ? { day: String(p.d).padStart(2, "0"), mon: MONTHS[p.m - 1].toUpperCase() } : null;
}

/** "12 Jan – 4 Apr 2027", "12 Jan 2027 –", null when neither end is known. */
export function formatRange(start: string | null, end: string | null): string | null {
  const a = parts(start);
  const b = parts(end);
  if (a && b) {
    const left = a.y === b.y ? `${a.d} ${MONTHS[a.m - 1]}` : formatDate(start);
    return `${left} – ${formatDate(end)}`;
  }
  if (a) return `From ${formatDate(start)}`;
  if (b) return `Until ${formatDate(end)}`;
  return null;
}

/** Local wall-clock time of a timestamp, "08:05"; null when unreadable. */
export function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD in the phone's time zone. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Route ids are enrolment uuids; anything else is "not found", not a server error. */
export function isUuid(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ── People ──────────────────────────────────────────────────────────────────

/** Same as the web's staffLabel: "First Last", else the email, else null. */
export function staffName(s: Staff | null): string | null {
  if (!s) return null;
  const n = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  return n || s.email || null;
}

// ── Applications ────────────────────────────────────────────────────────────

/** Open schools the person hasn't applied to yet (the web's one yellow band). */
export function notYetApplied(open: Programme[], applications: Pick<Application, "program_id">[]): Programme[] {
  const applied = new Set(applications.map((a) => a.program_id));
  return open.filter((p) => !applied.has(p.id));
}

// ── Grades (mirrors src/services/schools.ts on the web) ─────────────────────

const GRADE_POINTS: Record<string, number> = {
  A: 4.0, "A-": 3.7,
  "B+": 3.3, B: 3.0, "B-": 2.7,
  "C+": 2.3, C: 2.0, "C-": 1.7,
  "D+": 1.3, D: 1.0, "D-": 0.7,
  F: 0.0,
};

export function gradeToPoints(grade: string): number | null {
  return GRADE_POINTS[grade] ?? null;
}

export type CourseWithGrade = Course & { letterGrade: string | null };

export type GradeSummary = {
  courses: CourseWithGrade[];
  /** null until something counts towards it (W, I and P don't). */
  gpa: number | null;
  creditsEarned: number;
  creditsAttempted: number;
};

export function summariseGrades(courses: Course[], grades: Grade[]): GradeSummary {
  const byCourse = new Map<string, string>();
  for (const g of grades) if (g.letter_grade) byCourse.set(g.course_id, g.letter_grade);

  const list = [...courses]
    .sort((a, b) => a.sequence - b.sequence || (a.start_date ?? "").localeCompare(b.start_date ?? "") || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, letterGrade: byCourse.get(c.id) ?? null }));

  let points = 0;
  let weighted = 0;
  let attempted = 0;
  let earned = 0;
  for (const c of list) {
    if (!c.letterGrade) continue;
    attempted += c.credit_hours;
    if (!["F", "W", "I"].includes(c.letterGrade)) earned += c.credit_hours;
    const p = gradeToPoints(c.letterGrade);
    if (p === null) continue;
    points += p * c.credit_hours;
    weighted += c.credit_hours;
  }
  return {
    courses: list,
    gpa: weighted === 0 ? null : Math.round((points / weighted) * 100) / 100,
    creditsEarned: earned,
    creditsAttempted: attempted,
  };
}

// ── Where the person is in the school ───────────────────────────────────────

/**
 * The course running today ("now"), else the next one to start ("next").
 * Courses without dates are never marked.
 */
export function courseTiming(courses: Course[], today: string): Map<string, "now" | "next"> {
  const marks = new Map<string, "now" | "next">();
  const current = courses.find((c) => c.start_date && c.start_date.slice(0, 10) <= today && (!c.end_date || c.end_date.slice(0, 10) >= today));
  if (current) marks.set(current.id, "now");
  const upcoming = courses
    .filter((c) => c.start_date && c.start_date.slice(0, 10) > today)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))[0];
  if (upcoming) marks.set(upcoming.id, "next");
  return marks;
}

/** The arrival date that matters: the running or next course's, if it's still ahead. */
export function nextArrival(courses: Course[], today: string): string | null {
  const marks = courseTiming(courses, today);
  for (const c of courses) {
    if (marks.has(c.id) && c.arrival_date && c.arrival_date.slice(0, 10) >= today) return c.arrival_date;
  }
  return null;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export type AttendanceSummary = {
  total: number;
  /** Counts as the web does: only "present" is present (late is its own word). */
  present: number;
  /** Whole percent, null with no records (the web shows no figure then). */
  pct: number | null;
  byStatus: { status: string; label: string; count: number }[];
};

const STATUS_ORDER = ["present", "late", "excused", "absent"];

export function summariseAttendance(rows: Pick<AttendanceRecord, "status">[]): AttendanceSummary {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const present = counts.get("present") ?? 0;
  const byStatus = [...counts.entries()]
    .sort(([a], [b]) => {
      const ia = STATUS_ORDER.indexOf(a);
      const ib = STATUS_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    })
    .map(([status, count]) => ({ status, label: attendanceStatus(status).label, count }));
  return { total: rows.length, present, pct: rows.length ? Math.round((present / rows.length) * 100) : null, byStatus };
}

// ── Home shortcut (UX only: RLS decides what the screens can read) ──────────

/** Holds the web's Training module: admins, program leaders, or any schools.* permission. */
export function hasSchoolsModule(me: Me | null): boolean {
  if (!me) return false;
  return isAdmin(me) || hasRole(me, "program_leader") || me.permissions.some((p) => p.key.startsWith("schools."));
}

export function showSchoolsShortcut(me: Me | null, hasEnrolment: boolean): boolean {
  return hasEnrolment || hasSchoolsModule(me);
}
