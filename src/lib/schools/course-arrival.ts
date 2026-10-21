// ────────────────────────────────────────────────────────────
// FFSA Hub — a student's status in a school split into courses
// ────────────────────────────────────────────────────────────
// FFX runs as three courses (FFX / FFBX / FFWX) and a student signs up for
// any of them. Arrival is marked per course (migration 259), so "where is this
// student" is worked out from three things: which courses are on their track,
// which of those have started, and what staff marked on the Arrival tab.
//
// Pure and client-safe: the Students tab, the Overview tab and the Arrival tab
// all call it, so they always agree.
// ────────────────────────────────────────────────────────────

export type CourseArrivalStatus = "arrived" | "no_show";

export type SchoolCourse = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  start_date: string | null;
  end_date: string | null;
  /** FFX is never graded; FFBX and FFWX are (migration 259). */
  graded: boolean;
};

export type StudentTrack = { kind: "whole" | "segments" | "unknown"; codes: string[] };

export type StatusTone = "here" | "waiting" | "attention" | "problem" | "done" | "gone";

export type StudentStatus = {
  key:
    | "waiting"
    | "arrived"
    | "expected"
    | "no_show"
    | "between"
    | "finished"
    | "graduated"
    | "left"
    | "dismissed";
  label: string;
  tone: StatusTone;
  /** The course the status is about, when there is one. */
  courseCode?: string;
};

/** The courses on a student's track, in running order. An unset track counts as all of them. */
export function coursesOnTrack(track: StudentTrack, courses: SchoolCourse[]): SchoolCourse[] {
  const sorted = [...courses].sort((a, b) => a.sequence - b.sequence);
  if (track.kind !== "segments") return sorted;
  return sorted.filter((c) => track.codes.includes(c.code));
}

/** Where a course is in time. Undated courses never count as started. */
export function courseTiming(c: SchoolCourse, today: string): "upcoming" | "running" | "ended" {
  if (!c.start_date || c.start_date > today) return "upcoming";
  if (c.end_date && c.end_date < today) return "ended";
  return "running";
}

/**
 * Each course's arrival for one student. Enrolments marked arrived before
 * arrival went per course have no rows at all — for those, every course on
 * their track that has started counts as arrived, so old cohorts don't light
 * up as no-shows. Once any row exists the rows are the whole truth.
 */
export function arrivalsFor(
  enrollmentStatus: string,
  rows: Array<{ billing_course_id: string; status: CourseArrivalStatus }>,
  trackCourses: SchoolCourse[],
  today: string
): Map<string, CourseArrivalStatus> {
  const out = new Map<string, CourseArrivalStatus>(rows.map((r) => [r.billing_course_id, r.status]));
  if (rows.length === 0 && enrollmentStatus === "arrived") {
    for (const c of trackCourses) {
      if (courseTiming(c, today) !== "upcoming") out.set(c.id, "arrived");
    }
  }
  return out;
}

const TERMINAL: Record<string, StudentStatus> = {
  graduated: { key: "graduated", label: "Graduated", tone: "done" },
  decided_to_leave: { key: "left", label: "Left early", tone: "gone" },
  dismissed: { key: "dismissed", label: "Dismissed", tone: "gone" },
};

/**
 * One student's status. `courses` empty = a school that isn't split into
 * courses, where the single school-wide status is all there is.
 */
export function studentStatus(input: {
  enrollmentStatus: string;
  track: StudentTrack;
  courses: SchoolCourse[];
  arrivals: Map<string, CourseArrivalStatus>;
  today: string;
}): StudentStatus {
  const { enrollmentStatus, track, courses, arrivals, today } = input;
  if (TERMINAL[enrollmentStatus]) return TERMINAL[enrollmentStatus];

  if (courses.length === 0) {
    return enrollmentStatus === "arrived"
      ? { key: "arrived", label: "Arrived", tone: "here" }
      : { key: "waiting", label: "Waiting for arrival", tone: "waiting" };
  }

  const mine = coursesOnTrack(track, courses);
  const running = mine.find((c) => courseTiming(c, today) === "running");
  if (running) {
    const a = arrivals.get(running.id);
    if (a === "arrived") return { key: "arrived", label: `Arrived ${running.code}`, tone: "here", courseCode: running.code };
    if (a === "no_show") return { key: "no_show", label: `No-show ${running.code}`, tone: "problem", courseCode: running.code };
    // Started and nobody has marked them yet.
    return { key: "expected", label: `Not arrived ${running.code}`, tone: "attention", courseCode: running.code };
  }

  const started = mine.filter((c) => courseTiming(c, today) !== "upcoming");
  if (started.length === 0) {
    const first = mine[0];
    // Arriving a few days early for the first course still reads as arrived.
    if (first && arrivals.get(first.id) === "arrived") {
      return { key: "arrived", label: `Arrived ${first.code}`, tone: "here", courseCode: first.code };
    }
    return { key: "waiting", label: "Waiting for arrival", tone: "waiting" };
  }
  if (started.length === mine.length) return { key: "finished", label: "Finished", tone: "done" };

  const next = mine.find((c) => courseTiming(c, today) === "upcoming");
  if (next && arrivals.get(next.id) === "arrived") {
    return { key: "arrived", label: `Arrived ${next.code}`, tone: "here", courseCode: next.code };
  }
  return { key: "between", label: "Between courses", tone: "waiting", courseCode: next?.code };
}

/** The course a school is in today, else the next one to start, else the last one. */
export function focusCourse(courses: SchoolCourse[], today: string): SchoolCourse | null {
  const sorted = [...courses].sort((a, b) => a.sequence - b.sequence);
  return (
    sorted.find((c) => courseTiming(c, today) === "running") ??
    sorted.find((c) => courseTiming(c, today) === "upcoming") ??
    sorted[sorted.length - 1] ??
    null
  );
}
