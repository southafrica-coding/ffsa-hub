// ────────────────────────────────────────────────────────────
// Phone Training tab: Today (redesign 48a, prompt T4)
// ────────────────────────────────────────────────────────────
// A to-do list built only from signals the Hub already has. Nobody types a
// to-do. Each item is one tap from the screen that does the work; ticking
// it hides it for the ISO week (today_dismissals, migration 334). The
// single most urgent item becomes the screen's one yellow band.
//
// Pure: the route reads rows with the caller's own client (RLS decides) and
// this file only shapes them. The Monday briefing (T5) reuses buildToday.
// ────────────────────────────────────────────────────────────

import { daysBetween, firstName, OVERDUE_DAYS, type NameRow } from "@/lib/mobile/training";

export const DECIDE_AFTER_DAYS = 7;
export const REFERENCE_LATE_DAYS = 7;
/** Application statuses that are waiting on the school, not on the applicant. */
export const DECIDE_STATUSES = ["submitted", "references_received", "interview_scheduled"] as const;

export type TodayTarget =
  | { type: "student"; enrollmentId: string }
  | { type: "students"; filter: "needs_care" | "no_checkin" | "all" }
  | { type: "web"; path: string };

export type TodayKind = "care" | "checkin" | "checkins" | "decide" | "references" | "grade" | "fees";

export type TodayItem = {
  key: string;
  kind: TodayKind;
  /** 1 = most urgent. The band is the most urgent item not ticked off. */
  severity: 1 | 2 | 3;
  title: string;
  meta: string;
  count: number | null;
  target: TodayTarget;
  done: boolean;
};

export type TodayPayload = {
  weekOf: string;
  isoWeek: string;
  items: TodayItem[];
  /** key of the band item, or null when nothing open needs anyone. */
  band: string | null;
  open: number;
};

/** "2026-W48" for a YYYY-MM-DD date (ISO 8601 week-numbering year). */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow); // the Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** R 18,400 (rand sign, comma thousands, no cents for whole amounts). */
export function rand(amount: number): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  return `R ${amount.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ── Inputs ──────────────────────────────────────────────────

export type TodayStudent = {
  enrollmentId: string;
  userId: string;
  programId: string;
  programName: string;
  status: string;
  walkingWithMe: boolean;
  lastWeekOf: string | null;
};

export type OpenCare = { checkinId: string; enrollmentId: string; authorId: string; createdAt: string };

export type OpenApplication = { programId: string; programName: string; status: string; submittedAt: string };

export type LateReference = { programId: string; programName: string; since: string };

export type UngradedCourse = {
  programId: string;
  courseCode: string;
  courseName: string;
  endDate: string;
  ungraded: number;
  arrived: number;
};

export type OverdueCharge = { programId: string; programName: string; owed: number; enrollmentId: string | null };

export function buildToday(input: {
  me: string;
  today: string;
  weekOf: string;
  /** Schools the caller manages (has_schools_access). Leader items come only from these. */
  manages: Set<string>;
  students: TodayStudent[];
  care: OpenCare[];
  applications: OpenApplication[];
  references: LateReference[];
  ungraded: UngradedCourse[];
  overdue: OverdueCharge[];
  names: Map<string, NameRow>;
  dismissed: Set<string>;
}): TodayPayload {
  const items: Omit<TodayItem, "done">[] = [];
  const week = isoWeek(input.weekOf);
  const studentById = new Map(input.students.map((s) => [s.enrollmentId, s]));

  // 1 · Care flags nobody has taken: everyone who can see the student.
  for (const c of input.care) {
    const s = studentById.get(c.enrollmentId);
    if (!s || c.authorId === input.me) continue;
    items.push({
      key: `care:${c.checkinId}`,
      kind: "care",
      severity: 1,
      title: `${firstName(input.names.get(c.authorId))} flagged ${firstName(input.names.get(s.userId))}`,
      meta: "Check-in · needs care",
      count: null,
      target: { type: "student", enrollmentId: c.enrollmentId },
    });
  }

  // 2 · Check-ins: one line per student I walk with; one count per school I manage.
  const overdue = (s: TodayStudent) =>
    s.status === "arrived" && (!s.lastWeekOf || daysBetween(s.lastWeekOf, input.today) >= OVERDUE_DAYS);
  for (const s of input.students) {
    if (!s.walkingWithMe || !overdue(s)) continue;
    const days = s.lastWeekOf ? daysBetween(s.lastWeekOf, input.today) : null;
    items.push({
      key: `checkin:${s.enrollmentId}:${week}`,
      kind: "checkin",
      severity: 2,
      title: `Check in with ${firstName(input.names.get(s.userId))}`,
      meta: days === null ? "No check-in yet · a short one counts" : `${days} days since the last one`,
      count: null,
      target: { type: "student", enrollmentId: s.enrollmentId },
    });
  }
  const byProgram = new Map<string, { name: string; n: number }>();
  for (const s of input.students) {
    if (s.walkingWithMe || !input.manages.has(s.programId) || !overdue(s)) continue;
    const g = byProgram.get(s.programId) ?? { name: s.programName, n: 0 };
    g.n += 1;
    byProgram.set(s.programId, g);
  }
  for (const [programId, g] of byProgram) {
    items.push({
      key: `checkins:${programId}:${week}`,
      kind: "checkins",
      severity: 2,
      title: `${g.n} ${plural(g.n, "student hasn't", "students haven't")} had a check-in for 2 weeks`,
      meta: g.name,
      count: g.n,
      target: { type: "students", filter: "no_checkin" },
    });
  }

  // 3 · Decisions waiting more than a week (schools I manage).
  const decide = new Map<string, { name: string; n: number }>();
  for (const a of input.applications) {
    if (!input.manages.has(a.programId)) continue;
    if (!(DECIDE_STATUSES as readonly string[]).includes(a.status)) continue;
    if (daysBetween(a.submittedAt.slice(0, 10), input.today) <= DECIDE_AFTER_DAYS) continue;
    const g = decide.get(a.programId) ?? { name: a.programName, n: 0 };
    g.n += 1;
    decide.set(a.programId, g);
  }
  for (const [programId, g] of decide) {
    items.push({
      key: `decide:${programId}:${week}`,
      kind: "decide",
      severity: 2,
      title: `${g.n} ${plural(g.n, "applicant has", "applicants have")} waited more than a week`,
      meta: `${g.name} · decision needed`,
      count: g.n,
      target: { type: "web", path: "/schools" },
    });
  }

  // 4 · Grades for courses that have ended.
  for (const c of input.ungraded) {
    if (!input.manages.has(c.programId) || c.ungraded === 0) continue;
    items.push({
      key: `grade:${c.programId}:${c.courseCode}:${week}`,
      kind: "grade",
      severity: 3,
      title: `Grade ${c.courseCode || c.courseName}`,
      meta: `${c.ungraded} of ${c.arrived} ungraded · ended ${c.endDate}`,
      count: c.ungraded,
      target: { type: "web", path: "/schools" },
    });
  }

  // 5 · References more than a week late.
  const refs = new Map<string, { name: string; n: number }>();
  for (const r of input.references) {
    if (!input.manages.has(r.programId)) continue;
    if (daysBetween(r.since.slice(0, 10), input.today) <= REFERENCE_LATE_DAYS) continue;
    const g = refs.get(r.programId) ?? { name: r.programName, n: 0 };
    g.n += 1;
    refs.set(r.programId, g);
  }
  for (const [programId, g] of refs) {
    items.push({
      key: `references:${programId}:${week}`,
      kind: "references",
      severity: 3,
      title: `${g.n} ${plural(g.n, "reference is", "references are")} more than a week late`,
      meta: g.name,
      count: g.n,
      target: { type: "web", path: "/schools" },
    });
  }

  // 6 · Fees past due.
  const fees = new Map<string, { name: string; owed: number; students: Set<string> }>();
  for (const f of input.overdue) {
    if (!input.manages.has(f.programId) || f.owed <= 0) continue;
    const g = fees.get(f.programId) ?? { name: f.programName, owed: 0, students: new Set<string>() };
    g.owed += f.owed;
    if (f.enrollmentId) g.students.add(f.enrollmentId);
    fees.set(f.programId, g);
  }
  for (const [programId, g] of fees) {
    const n = g.students.size || 1;
    items.push({
      key: `fees:${programId}:${week}`,
      kind: "fees",
      severity: 3,
      title: `Chase ${n} fee ${plural(n, "balance", "balances")}`,
      meta: `${rand(g.owed)} overdue · ${g.name}`,
      count: n,
      target: { type: "web", path: "/schools" },
    });
  }

  const shaped: TodayItem[] = items
    .map((i) => ({ ...i, done: input.dismissed.has(i.key) }))
    .sort((a, b) => Number(a.done) - Number(b.done) || a.severity - b.severity);
  const band = shaped.find((i) => !i.done) ?? null;
  return {
    weekOf: input.weekOf,
    isoWeek: week,
    items: shaped,
    band: band?.key ?? null,
    open: shaped.filter((i) => !i.done).length,
  };
}

