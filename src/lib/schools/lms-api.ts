// Browser client for the Schools LMS API drafted in pull request 501.
// Fee items are not part of this contract. They stay on
// /finance/school-fees/:programId/billing.

export const COURSE_DESIGN_VERSION = 1 as const;

export const LETTER_GRADES = [
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F",
  "W",
  "I",
  "P",
] as const;

export type LetterGrade = (typeof LETTER_GRADES)[number];

export type DesignItem =
  | { kind: "page"; title: string; body: string }
  | {
      kind: "assignment";
      title: string;
      brief: string;
      points: number;
      due_offset_days?: number;
    }
  | { kind: "discussion"; title: string; prompt: string };

export type DesignModule = {
  title: string;
  summary?: string;
  items: DesignItem[];
};

export type CourseDesign = {
  schema_version: typeof COURSE_DESIGN_VERSION;
  summary?: string;
  modules: DesignModule[];
};

export type DesignSummary = {
  modules: number;
  pages: number;
  assignments: number;
  discussions: number;
  points: number;
};

export type LearningCourseBody = {
  code: string;
  name: string;
  description: string | null;
  notes: string | null;
  scope: "full_program" | "segment";
  sequence: number;
  status: "upcoming" | "active" | "completed" | "archived";
  start_date: string | null;
  end_date: string | null;
  arrival_date: string | null;
  credit_hours: number;
  graded: boolean;
  lead_staff_id: string | null;
};

export type LmsFailure = {
  status: number;
  code: string;
  message: string;
};

const API_NOT_DEPLOYED =
  "This classroom call is not on the hub yet. It arrives with the schools LMS API (draft pull request 501). Nothing here was saved.";

export function feeSetupHref(programId: string, courseId?: string) {
  return courseId
    ? `/finance/school-fees/${programId}/billing/${courseId}`
    : `/finance/school-fees/${programId}/billing`;
}

export function classroomHref(programId: string) {
  return `/schools/${programId}?tab=classroom`;
}

export function emptyDesign(): CourseDesign {
  return {
    schema_version: COURSE_DESIGN_VERSION,
    summary: "",
    modules: [{ title: "Module 1", items: [] }],
  };
}

export function summarizeDesign(design: CourseDesign): DesignSummary {
  let pages = 0;
  let assignments = 0;
  let discussions = 0;
  let points = 0;
  for (const section of design.modules) {
    for (const item of section.items) {
      if (item.kind === "page") pages += 1;
      if (item.kind === "discussion") discussions += 1;
      if (item.kind === "assignment") {
        assignments += 1;
        points += item.points;
      }
    }
  }
  return { modules: design.modules.length, pages, assignments, discussions, points };
}

export function summaryLine(summary: DesignSummary | null | undefined): string {
  if (!summary) return "No design yet";
  const bits = [
    `${summary.modules} ${summary.modules === 1 ? "module" : "modules"}`,
    `${summary.pages} ${summary.pages === 1 ? "page" : "pages"}`,
    `${summary.assignments} ${summary.assignments === 1 ? "assignment" : "assignments"}`,
  ];
  if (summary.discussions) {
    bits.push(`${summary.discussions} ${summary.discussions === 1 ? "discussion" : "discussions"}`);
  }
  if (summary.points) bits.push(`${summary.points} points`);
  return bits.join(" · ");
}

function badTitle(value: string): boolean {
  const title = value.trim();
  return title.length < 1 || title.length > 160;
}

/** Mirrors the API's design rules so the form can explain a problem before saving. */
export function designIssues(design: CourseDesign): string | null {
  if (design.schema_version !== COURSE_DESIGN_VERSION) {
    return "The course design is not a valid template.";
  }
  if (design.summary && design.summary.trim().length > 4000) {
    return "The summary must be under 4000 characters.";
  }
  if (design.modules.length < 1 || design.modules.length > 40) {
    return "A design needs between 1 and 40 modules.";
  }
  for (const section of design.modules) {
    if (badTitle(section.title)) return "Each module needs a title, under 160 characters.";
    if (section.summary && section.summary.trim().length > 2000) {
      return "A module summary must be under 2000 characters.";
    }
    if (section.items.length > 40) return "A module can hold up to 40 items.";
    for (const item of section.items) {
      if (badTitle(item.title)) return "Each item needs a title, under 160 characters.";
      if (item.kind === "page" && item.body.length > 50_000) return "A page is too long.";
      if (item.kind === "assignment") {
        if (item.brief.length > 20_000) return "An assignment brief is too long.";
        if (!Number.isInteger(item.points) || item.points < 0 || item.points > 1000) {
          return "Points must be a whole number from 0 to 1000.";
        }
        if (
          item.due_offset_days != null &&
          (!Number.isInteger(item.due_offset_days) || item.due_offset_days < 0 || item.due_offset_days > 365)
        ) {
          return "Due offset must be a whole number of days from 0 to 365.";
        }
      }
      if (item.kind === "discussion" && item.prompt.length > 8000) return "A discussion prompt is too long.";
    }
  }
  return null;
}

export function cleanDesign(design: CourseDesign): CourseDesign {
  return {
    schema_version: COURSE_DESIGN_VERSION,
    ...(design.summary?.trim() ? { summary: design.summary.trim() } : {}),
    modules: design.modules.map((section) => ({
      title: section.title.trim(),
      ...(section.summary?.trim() ? { summary: section.summary.trim() } : {}),
      items: section.items.map((item) => {
        if (item.kind === "page") return { kind: "page", title: item.title.trim(), body: item.body };
        if (item.kind === "discussion") {
          return { kind: "discussion", title: item.title.trim(), prompt: item.prompt };
        }
        return {
          kind: "assignment",
          title: item.title.trim(),
          brief: item.brief,
          points: item.points,
          ...(item.due_offset_days != null ? { due_offset_days: item.due_offset_days } : {}),
        };
      }),
    })),
  };
}

export function designFromUnknown(value: unknown): CourseDesign | null {
  if (!value || typeof value !== "object") return null;
  const design = value as CourseDesign;
  if (!Array.isArray(design.modules)) return null;
  const issues = designIssues({ ...design, schema_version: COURSE_DESIGN_VERSION });
  return issues ? null : cleanDesign({ ...design, schema_version: COURSE_DESIGN_VERSION });
}

const CODE = /^[A-Za-z0-9]{2,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function learningCourseIssues(body: LearningCourseBody): string | null {
  if (!CODE.test(body.code.trim().toUpperCase())) {
    return "Course code must be 2–16 letters or numbers.";
  }
  const name = body.name.trim();
  if (name.length < 2 || name.length > 120) return "Course name must be 2–120 characters.";
  if (body.description && body.description.trim().length > 4000) {
    return "Description must be under 4000 characters.";
  }
  if (body.notes && body.notes.trim().length > 2000) return "Notes must be under 2000 characters.";
  if (body.scope !== "full_program" && body.scope !== "segment") {
    return "Scope must be full_program or segment.";
  }
  if (!["upcoming", "active", "completed", "archived"].includes(body.status)) {
    return "Status must be upcoming, active, completed, or archived.";
  }
  if (!Number.isInteger(body.sequence) || body.sequence < 0 || body.sequence > 999) {
    return "Sequence must be a whole number from 0 to 999.";
  }
  if (!Number.isInteger(body.credit_hours) || body.credit_hours < 0 || body.credit_hours > 40) {
    return "Credit hours must be a whole number from 0 to 40.";
  }
  for (const field of ["start_date", "end_date", "arrival_date"] as const) {
    const value = body[field];
    if (value && !DATE.test(value)) return `${field} must be YYYY-MM-DD.`;
  }
  if (body.start_date && body.end_date && body.end_date < body.start_date) {
    return "The end date cannot be before the start date.";
  }
  if (body.arrival_date && body.start_date && body.arrival_date > body.start_date) {
    return "Arrival cannot be after the course starts.";
  }
  return null;
}

export function isLetterGrade(value: string): value is LetterGrade {
  return (LETTER_GRADES as readonly string[]).includes(value);
}

/** Missing or non-boolean `graded` is not graded. Only an explicit true counts. */
export function courseIsGraded(value: unknown): boolean {
  return value === true;
}

/** GET /api/schools/grades/marks. Missing flags stay closed. */
export function marksAllowsOfficialPost(body: { can_post_official?: unknown } | null | undefined): boolean {
  return body?.can_post_official === true;
}

export function marksAllowsOtherNotes(body: { can_see_other_graders_notes?: unknown } | null | undefined): boolean {
  return body?.can_see_other_graders_notes === true;
}

/** Shape of GET /api/schools/programs/:programId/grader-candidates. */
export type GraderCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email?: string | null;
};

/** Same name the candidates API sorts by: preferred name, then first name. */
export function candidateName(
  person:
    | (Pick<GraderCandidate, "first_name" | "last_name" | "preferred_name"> & { email?: string | null })
    | null
    | undefined,
  fallback = "Assigned grader"
): string {
  if (!person) return fallback;
  const name = `${person.preferred_name || person.first_name || ""} ${person.last_name || ""}`.trim();
  return name || person.email || fallback;
}

function optionalName(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** One row of `{ candidates: [{ id, first_name, last_name, preferred_name }] }`. */
function personFromCandidate(item: unknown): GraderCandidate | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  const first_name = optionalName(row.first_name);
  const last_name = optionalName(row.last_name);
  const preferred_name = optionalName(row.preferred_name);
  if (first_name === undefined || last_name === undefined || preferred_name === undefined) return null;
  return { id: row.id.trim(), first_name, last_name, preferred_name };
}

/** GET /api/schools/programs/:programId/grader-candidates. Any other shape yields nobody. */
export function parseGraderCandidates(body: unknown): GraderCandidate[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const people: GraderCandidate[] = [];
  for (const item of list) {
    const person = personFromCandidate(item);
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    people.push(person);
  }
  return people;
}

/** Due date shown to a student. Offset is days after the course start. */
export function dueOn(startDate: string | null | undefined, offset: number | undefined): string | null {
  if (!startDate || offset == null || !DATE.test(startDate)) return null;
  const [year, month, day] = startDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export type TrackScope = { kind: "whole" | "segments" | "unknown"; codes: string[] };

export type QueueCourse = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  graded: boolean;
};

/**
 * Graded courses a student is actually on. An empty track means the whole
 * school, matching the roster. Whole-programme students sit every course.
 */
export function gradedCoursesForStudent(
  courses: QueueCourse[],
  segments: Array<{ billing_course_id: string | null; code: string | null }>,
  pipeline: TrackScope | null
): QueueCourse[] {
  const sorted = [...courses].sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
  let track: TrackScope = { kind: "unknown", codes: [] };
  if (segments.some((segment) => segment.billing_course_id == null) && segments.length > 0) {
    track = { kind: "whole", codes: [] };
  } else if (segments.length > 0) {
    track = {
      kind: "segments",
      codes: segments.map((segment) => segment.code).filter((code): code is string => !!code),
    };
  } else if (pipeline) {
    track = pipeline;
  }
  const onTrack = track.kind === "segments" ? sorted.filter((course) => track.codes.includes(course.code)) : sorted;
  return onTrack.filter((course) => course.graded);
}

export function combineReasonCopy(combined: {
  ready: boolean;
  letter: string | null;
  reason: string;
}): string {
  if (combined.reason === "no_marks") return "No one has marked this yet.";
  if (combined.reason === "waiting_on_graders") return "Still waiting on a grader.";
  if (combined.reason === "needs_a_person") {
    return "W, I, and P are not averaged. A person posts the official letter.";
  }
  if (combined.reason === "ready" && combined.letter) {
    return `The marks average to ${combined.letter}. A tie goes to the higher letter.`;
  }
  return "The marks are not ready for an official letter.";
}

function failureFromBody(status: number, body: unknown): LmsFailure {
  if (status === 404 && (!body || typeof body !== "object" || !("error" in body))) {
    return { status, code: "not_deployed", message: API_NOT_DEPLOYED };
  }
  const record = body && typeof body === "object" ? (body as { error?: unknown; message?: unknown }) : {};
  const code = typeof record.error === "string" ? record.error : "server_error";
  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message
      : status === 404
        ? API_NOT_DEPLOYED
        : "Something went wrong.";
  return { status, code, message };
}

export async function lmsCall<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw { status: 0, code: "network", message: "The hub could not be reached." } satisfies LmsFailure;
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) throw failureFromBody(response.status, parsed);
  return parsed as T;
}

export function isLmsFailure(error: unknown): error is LmsFailure {
  return !!error && typeof error === "object" && "message" in error && "code" in error && "status" in error;
}

export function lmsMessage(error: unknown): string {
  if (isLmsFailure(error)) return error.message;
  return "Something went wrong.";
}
