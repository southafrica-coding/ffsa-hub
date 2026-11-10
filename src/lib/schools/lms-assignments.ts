// Schools LMS assignments (slice 2): pure types and helpers shared by the
// service, the API routes and the client UI. No database, storage or
// sanitizer imports, so it is safe to bundle on the client.
//
// Tables (migration 310): lms_assignments → lms_submissions (one row per
// attempt) → lms_submission_files, and lms_grades (one per attempt).

import { normaliseLinkUrl, type Result } from "@/lib/schools/lms-content";

export type SubmissionType = "text" | "link" | "file";
export const SUBMISSION_TYPES: readonly SubmissionType[] = ["text", "link", "file"];

export const ASSIGNMENT_TITLE_MAX = 200;
export const ASSIGNMENT_INSTRUCTIONS_MAX = 20_000;
export const ASSIGNMENT_POINTS_MAX = 10_000;
export const SUBMISSION_TEXT_MAX = 50_000;
export const FEEDBACK_MAX = 10_000;
export const MAX_FILES_PER_ATTEMPT = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const SIGNED_URL_TTL_SECONDS = 300;
export const LMS_SUBMISSIONS_BUCKET = "lms-submissions";

/**
 * Matches lms_submission_files.mime CHECK and the bucket allowlist in 310.
 * Note: .doc and .ppt (old Office formats) can carry macros. They are still
 * allowed; downloads are attachments named for their stored type, and
 * Office opens downloaded files in Protected View.
 */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
};
/** Extension → mime, for phones that hand over HEIC / Office files with an empty file.type. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(ALLOWED_FILE_TYPES).map(([mime, ext]) => [ext, mime])),
  jpeg: "image/jpeg",
  heif: "image/heic",
};

/** The allowed mime for a file name's extension, or null. */
export function mimeFromFileName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Types stored as another allowed type. Android labels HEIC photos
 * image/heif; the bucket and the 310 CHECK only know image/heic.
 */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/heif": "image/heic",
};

/** The browser's type when it gave one we accept; else derived from the extension. */
export function resolveFileMime(name: string, browserType: string | null | undefined): string | null {
  const raw = (browserType ?? "").trim().toLowerCase();
  const t = MIME_ALIASES[raw] ?? raw;
  if (t && ALLOWED_FILE_TYPES[t]) return t;
  if (!t || t === "application/octet-stream") return mimeFromFileName(name);
  return null;
}

/** True when the name's extension is one of the extensions for this allowed type. */
export function fileNameMatchesMime(name: string, mime: string): boolean {
  return !!ALLOWED_FILE_TYPES[mime] && mimeFromFileName(name) === mime;
}

/**
 * The name a download is saved as: the uploaded name without its
 * extension, cleaned, plus the extension of the type we stored. The raw
 * stored name's extension is never used, so a file registered as a PDF
 * always downloads as .pdf.
 */
export function downloadFileName(storedName: string, mime: string): string {
  const ext = ALLOWED_FILE_TYPES[mime] ?? "bin";
  const leaf = storedName.split(/[\\/]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  const base = (dot > 0 ? leaf.slice(0, dot) : leaf)
    // Control characters, quotes and characters Windows forbids in names.
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*;]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${base || "submission"}.${ext}`;
}

export const FILE_ACCEPT_ATTR = [
  ...Object.keys(ALLOWED_FILE_TYPES),
  ...Object.keys(MIME_ALIASES),
  ...Object.keys(MIME_BY_EXT).map((ext) => `.${ext}`),
].join(",");

export type LmsAssignment = {
  id: string;
  course_id: string;
  lesson_id: string | null;
  title: string;
  instructions: string | null;
  due_at: string | null;
  allow_late: boolean;
  submission_types: SubmissionType[];
  max_points: number;
  published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LmsSubmission = {
  id: string;
  assignment_id: string;
  enrollment_id: string;
  attempt_no: number;
  body_text: string | null;
  link_url: string | null;
  status: "draft" | "submitted";
  submitted_at: string | null;
  is_late: boolean;
  created_at: string;
  updated_at: string;
};

export type LmsSubmissionFile = {
  id: string;
  submission_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
};

export type LmsGrade = {
  id: string;
  submission_id: string;
  points: number;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string;
  released_at: string | null;
  released_by: string | null;
  /** Optimistic-concurrency token for re-grading (PUT …/grade). */
  updated_at: string;
};

export type AttemptWithDetail = LmsSubmission & {
  files: LmsSubmissionFile[];
  grade: LmsGrade | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ── Late rule ───────────────────────────────────────────────

/** Past the due date? No due date is never late. */
export function isPastDue(dueAt: string | null, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  return Number.isFinite(due) && now.getTime() > due;
}

/**
 * What submitting right now means. Mirrors lms_submissions_guard():
 * allow_late on → accepted and marked late; off → refused (409).
 */
export function lateDecision(
  assignment: Pick<LmsAssignment, "due_at" | "allow_late">,
  now: Date = new Date()
): { allowed: boolean; late: boolean } {
  const late = isPastDue(assignment.due_at, now);
  return { allowed: !late || assignment.allow_late, late };
}

// ── Points ──────────────────────────────────────────────────

/** Points between 0 and max_points inclusive, at most 2 decimals. */
export function validatePoints(raw: unknown, maxPoints: number): Result<number> {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return { ok: false, error: "Points must be a number" };
  }
  if (n < 0) return { ok: false, error: "Points cannot be negative" };
  if (n > maxPoints) return { ok: false, error: `Points cannot be more than ${maxPoints}` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export type GradeInput = { points: number; feedback: string | null; release: boolean };

export function validateGradeInput(raw: unknown, maxPoints: number): Result<GradeInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const points = validatePoints(body.points, maxPoints);
  if (!points.ok) return points;
  let feedback: string | null = null;
  if (body.feedback !== undefined && body.feedback !== null) {
    if (typeof body.feedback !== "string") return { ok: false, error: "Feedback must be text" };
    if (body.feedback.length > FEEDBACK_MAX) {
      return { ok: false, error: `Feedback must be ${FEEDBACK_MAX} characters or fewer` };
    }
    feedback = body.feedback.trim() || null;
  }
  if (body.release !== undefined && typeof body.release !== "boolean") {
    return { ok: false, error: "release must be true or false" };
  }
  return { ok: true, value: { points: points.value, feedback, release: body.release === true } };
}

// ── Assignment input ────────────────────────────────────────

export type AssignmentInput = {
  title: string;
  instructions: string | null;
  due_at: string | null;
  allow_late: boolean;
  submission_types: SubmissionType[];
  max_points: number;
  lesson_id: string | null;
};
export type AssignmentPatch = Partial<AssignmentInput & { published: boolean }>;

/** Accepts a non-empty subset of text / link / file, de-duplicated, in canonical order. */
export function validateSubmissionTypes(raw: unknown): Result<SubmissionType[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Choose at least one submission type" };
  }
  for (const t of raw) {
    if (!(SUBMISSION_TYPES as readonly unknown[]).includes(t)) {
      return { ok: false, error: `Unknown submission type: ${String(t)}` };
    }
  }
  return { ok: true, value: SUBMISSION_TYPES.filter((t) => raw.includes(t)) };
}

function cleanTitle(raw: unknown): Result<string> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Title is required" };
  const title = raw.trim();
  if (title.length > ASSIGNMENT_TITLE_MAX) {
    return { ok: false, error: `Title must be ${ASSIGNMENT_TITLE_MAX} characters or fewer` };
  }
  return { ok: true, value: title };
}

function cleanInstructions(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Instructions must be text" };
  if (raw.length > ASSIGNMENT_INSTRUCTIONS_MAX) {
    return { ok: false, error: `Instructions must be ${ASSIGNMENT_INSTRUCTIONS_MAX} characters or fewer` };
  }
  return { ok: true, value: raw.trim() || null };
}

function cleanDueAt(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Due date must be a date" };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { ok: false, error: "Due date is not a valid date" };
  return { ok: true, value: new Date(t).toISOString() };
}

function cleanMaxPoints(raw: unknown): Result<number> {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "Points must be more than 0" };
  }
  if (n > ASSIGNMENT_POINTS_MAX) {
    return { ok: false, error: `Points must be ${ASSIGNMENT_POINTS_MAX} or fewer` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function cleanLessonId(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (!isUuid(raw)) return { ok: false, error: "lesson_id must be a lesson id" };
  return { ok: true, value: raw };
}

function cleanBool(raw: unknown, name: string): Result<boolean | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "boolean") return { ok: false, error: `${name} must be true or false` };
  return { ok: true, value: raw };
}

export function validateAssignmentInput(raw: unknown): Result<AssignmentInput & { course_id: string }> {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!isUuid(body.course_id)) return { ok: false, error: "course_id is required" };
  const title = cleanTitle(body.title);
  if (!title.ok) return title;
  const instructions = cleanInstructions(body.instructions);
  if (!instructions.ok) return instructions;
  const due = cleanDueAt(body.due_at);
  if (!due.ok) return due;
  const allowLate = cleanBool(body.allow_late, "allow_late");
  if (!allowLate.ok) return allowLate;
  const types = validateSubmissionTypes(body.submission_types ?? ["text"]);
  if (!types.ok) return types;
  const max = cleanMaxPoints(body.max_points);
  if (!max.ok) return max;
  const lesson = cleanLessonId(body.lesson_id);
  if (!lesson.ok) return lesson;
  return {
    ok: true,
    value: {
      course_id: body.course_id,
      title: title.value,
      instructions: instructions.value,
      due_at: due.value,
      allow_late: allowLate.value ?? true,
      submission_types: types.value,
      max_points: max.value,
      lesson_id: lesson.value,
    },
  };
}

export function validateAssignmentPatch(raw: unknown): Result<AssignmentPatch> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const patch: AssignmentPatch = {};
  if ("course_id" in body) return { ok: false, error: "An assignment cannot move to another course" };
  if ("title" in body) {
    const r = cleanTitle(body.title);
    if (!r.ok) return r;
    patch.title = r.value;
  }
  if ("instructions" in body) {
    const r = cleanInstructions(body.instructions);
    if (!r.ok) return r;
    patch.instructions = r.value;
  }
  if ("due_at" in body) {
    const r = cleanDueAt(body.due_at);
    if (!r.ok) return r;
    patch.due_at = r.value;
  }
  if ("submission_types" in body) {
    const r = validateSubmissionTypes(body.submission_types);
    if (!r.ok) return r;
    patch.submission_types = r.value;
  }
  if ("max_points" in body) {
    const r = cleanMaxPoints(body.max_points);
    if (!r.ok) return r;
    patch.max_points = r.value;
  }
  if ("lesson_id" in body) {
    const r = cleanLessonId(body.lesson_id);
    if (!r.ok) return r;
    patch.lesson_id = r.value;
  }
  for (const key of ["allow_late", "published"] as const) {
    const r = cleanBool(body[key], key);
    if (!r.ok) return r;
    if (r.value !== undefined) patch[key] = r.value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: patch };
}

// ── Submission content ──────────────────────────────────────

export type SubmissionContent = { body_text: string | null; link_url: string | null };

/**
 * Text and link for a draft or a submit. A field the assignment does not
 * allow must be empty. On submit, at least one allowed thing (text, link or
 * an uploaded file) must be present.
 */
export function validateSubmissionContent(
  raw: unknown,
  types: readonly SubmissionType[],
  opts: { submitting: boolean; fileCount: number }
): Result<SubmissionContent> {
  const body = (raw ?? {}) as Record<string, unknown>;

  let bodyText: string | null = null;
  if (body.body_text !== undefined && body.body_text !== null && body.body_text !== "") {
    if (typeof body.body_text !== "string") return { ok: false, error: "Text must be text" };
    if (body.body_text.length > SUBMISSION_TEXT_MAX) {
      return { ok: false, error: `Text must be ${SUBMISSION_TEXT_MAX} characters or fewer` };
    }
    bodyText = body.body_text.trim() ? body.body_text : null;
  }
  if (bodyText !== null && !types.includes("text")) {
    return { ok: false, error: "This assignment does not take a text answer" };
  }

  let linkUrl: string | null = null;
  if (body.link_url !== undefined && body.link_url !== null && body.link_url !== "") {
    linkUrl = normaliseLinkUrl(body.link_url);
    if (!linkUrl) return { ok: false, error: "Link must start with http:// or https://" };
  }
  if (linkUrl !== null && !types.includes("link")) {
    return { ok: false, error: "This assignment does not take a link" };
  }

  if (opts.fileCount > 0 && !types.includes("file")) {
    return { ok: false, error: "This assignment does not take files" };
  }

  if (opts.submitting && bodyText === null && linkUrl === null && opts.fileCount === 0) {
    return { ok: false, error: "Add your answer before submitting" };
  }
  return { ok: true, value: { body_text: bodyText, link_url: linkUrl } };
}

// ── Attempts ────────────────────────────────────────────────

/** The current attempt: highest attempt_no among submitted rows. Drafts never count. */
export function currentAttempt<T extends Pick<LmsSubmission, "attempt_no" | "status">>(
  attempts: readonly T[]
): T | null {
  let best: T | null = null;
  for (const a of attempts) {
    if (a.status !== "submitted") continue;
    if (!best || a.attempt_no > best.attempt_no) best = a;
  }
  return best;
}

export function openDraft<T extends Pick<LmsSubmission, "status">>(attempts: readonly T[]): T | null {
  return attempts.find((a) => a.status === "draft") ?? null;
}

/** Attempts newest first. */
export function attemptsNewestFirst<T extends Pick<LmsSubmission, "attempt_no">>(attempts: readonly T[]): T[] {
  return [...attempts].sort((a, b) => b.attempt_no - a.attempt_no);
}

/**
 * How a submit lands: update the open draft, or insert a fresh attempt
 * (the DB numbers it max + 1, so after a submitted or graded attempt this
 * is attempt N + 1).
 */
export function submitPlan(
  attempts: readonly Pick<LmsSubmission, "id" | "status" | "attempt_no">[]
): { kind: "submit_draft"; draftId: string } | { kind: "new_attempt"; attemptNo: number } {
  const draft = openDraft(attempts);
  if (draft) return { kind: "submit_draft", draftId: draft.id };
  const top = attempts.reduce((m, a) => Math.max(m, a.attempt_no), 0);
  return { kind: "new_attempt", attemptNo: top + 1 };
}

// ── Status ──────────────────────────────────────────────────

export type GradingStatus = "missing" | "submitted" | "late" | "graded" | "released";

/** Staff view of one student on one assignment, from the current attempt and its grade. */
export function gradingStatus(
  current: Pick<LmsSubmission, "is_late"> | null,
  grade: Pick<LmsGrade, "released_at"> | null
): GradingStatus {
  if (!current) return "missing";
  if (grade?.released_at) return "released";
  if (grade) return "graded";
  return current.is_late ? "late" : "submitted";
}

export type GradingCounts = Record<GradingStatus, number> & { total: number };

export function countStatuses(statuses: readonly GradingStatus[]): GradingCounts {
  const counts: GradingCounts = { total: statuses.length, missing: 0, submitted: 0, late: 0, graded: 0, released: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}

export type StudentBucket = "todo" | "submitted" | "graded";

/** To do / Submitted / Graded for the student list. Only a released grade on the current attempt counts. */
export function studentBucket(
  current: Pick<LmsSubmission, "status"> | null,
  releasedGrade: Pick<LmsGrade, "released_at"> | null
): StudentBucket {
  if (!current) return "todo";
  if (releasedGrade?.released_at) return "graded";
  return "submitted";
}

/** Strip any grade a student must not see (unreleased). Defence in depth behind RLS. */
export function releasedOnly<T extends { grade: LmsGrade | null }>(attempt: T): T {
  if (attempt.grade && !attempt.grade.released_at) return { ...attempt, grade: null };
  return attempt;
}

// ── Files ───────────────────────────────────────────────────

export type UploadRequest = { file_name: string; mime: string; size_bytes: number; ext: string };

export const FILE_TYPE_MISMATCH = "file_type_mismatch";

export function validateUploadRequest(
  raw: unknown,
  existingFiles: number
): Result<UploadRequest> | { ok: false; error: string; code: typeof FILE_TYPE_MISMATCH } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const name = typeof body.file_name === "string" ? body.file_name.trim() : "";
  if (!name) return { ok: false, error: "file_name is required" };
  // An empty / octet-stream type (common for HEIC and Office files on
  // iOS and Android) falls back to the file extension.
  const mime = resolveFileMime(name, typeof body.mime === "string" ? body.mime : "") ?? "";
  const ext = ALLOWED_FILE_TYPES[mime];
  if (!ext) {
    return { ok: false, error: "That file type is not allowed. Use PDF, an image, Word, PowerPoint or plain text." };
  }
  // The name must agree with the type (payload.exe declared as a PDF is refused).
  if (!fileNameMatchesMime(name, mime)) {
    return {
      ok: false,
      code: FILE_TYPE_MISMATCH,
      error: `This file's name doesn't match its type. Rename it to end in .${ext} and try again.`,
    };
  }
  const size = typeof body.size_bytes === "number" ? body.size_bytes : Number.NaN;
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "size_bytes is required" };
  if (size > MAX_FILE_BYTES) return { ok: false, error: "Files must be 20 MB or smaller" };
  if (existingFiles >= MAX_FILES_PER_ATTEMPT) {
    return { ok: false, error: `An attempt can hold at most ${MAX_FILES_PER_ATTEMPT} files` };
  }
  return { ok: true, value: { file_name: name.slice(0, 255), mime, size_bytes: size, ext } };
}

/**
 * {program_id}/{assignment_id}/{submission_id}/{random_uuid}.{ext}
 * Ids only: never a user id or email, because signed URLs carry the path.
 */
export function buildSubmissionPath(parts: {
  programId: string;
  assignmentId: string;
  submissionId: string;
  objectId: string;
  ext: string;
}): string {
  for (const id of [parts.programId, parts.assignmentId, parts.submissionId, parts.objectId]) {
    if (!isUuid(id)) throw new Error("buildSubmissionPath: ids must be uuids");
  }
  if (!/^[a-z0-9]{1,5}$/.test(parts.ext)) throw new Error("buildSubmissionPath: bad extension");
  return `${parts.programId}/${parts.assignmentId}/${parts.submissionId}/${parts.objectId}.${parts.ext}`;
}

// ── Display ─────────────────────────────────────────────────

/** An href safe to render: http(s) only, else null. */
export function safeHref(url: string | null | undefined): string | null {
  return url ? normaliseLinkUrl(url) : null;
}

const SAST_OFFSET = "+02:00"; // Africa/Johannesburg has no daylight saving.

/** ISO → "YYYY-MM-DDTHH:mm" in Africa/Johannesburg, for <input type="datetime-local">. */
export function toJohannesburgInput(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" typed in Johannesburg time → ISO, or null when empty. */
export function fromJohannesburgInput(local: string): string | null {
  if (!local) return null;
  const t = Date.parse(`${local}:00${SAST_OFFSET}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function formatDue(iso: string | null): string {
  if (!iso) return "No due date";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatPoints(points: number, max: number): string {
  return `${Number(points)} / ${Number(max)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Row builders ────────────────────────────────────────────

export type RosterEntry = {
  enrollment_id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export function studentName(r: Pick<RosterEntry, "first_name" | "last_name" | "preferred_name">): string {
  const first = r.preferred_name?.trim() || r.first_name?.trim() || "";
  const name = [first, r.last_name?.trim() ?? ""].filter(Boolean).join(" ");
  return name || "Unnamed student";
}

type AttemptSummarySource = Pick<
  LmsSubmission,
  "id" | "assignment_id" | "enrollment_id" | "attempt_no" | "status" | "is_late" | "submitted_at"
> & { grade: Pick<LmsGrade, "id" | "points" | "released_at"> | null };

export type GradingRow = {
  enrollment_id: string;
  name: string;
  status: GradingStatus;
  attempts: number;
  current: {
    submission_id: string;
    attempt_no: number;
    submitted_at: string | null;
    is_late: boolean;
    grade: { id: string; points: number; released_at: string | null } | null;
  } | null;
};

/** One row per roster student for one assignment, from that assignment's submitted attempts. */
export function buildGradingRows(
  roster: readonly RosterEntry[],
  attempts: readonly AttemptSummarySource[],
  assignmentId: string
): GradingRow[] {
  const byStudent = new Map<string, AttemptSummarySource[]>();
  for (const a of attempts) {
    if (a.assignment_id !== assignmentId || a.status !== "submitted") continue;
    const list = byStudent.get(a.enrollment_id) ?? [];
    list.push(a);
    byStudent.set(a.enrollment_id, list);
  }
  return roster.map((r) => {
    const mine = byStudent.get(r.enrollment_id) ?? [];
    const cur = currentAttempt(mine);
    return {
      enrollment_id: r.enrollment_id,
      name: studentName(r),
      status: gradingStatus(cur, cur?.grade ?? null),
      attempts: mine.length,
      current: cur
        ? {
            submission_id: cur.id,
            attempt_no: cur.attempt_no,
            submitted_at: cur.submitted_at,
            is_late: cur.is_late,
            grade: cur.grade ? { id: cur.grade.id, points: Number(cur.grade.points), released_at: cur.grade.released_at } : null,
          }
        : null,
    };
  });
}

export type StudentAssignmentItem = {
  assignment: Pick<
    LmsAssignment,
    "id" | "title" | "due_at" | "allow_late" | "submission_types" | "max_points" | "course_id"
  > & { course_title?: string };
  bucket: StudentBucket;
  has_draft: boolean;
  attempts: number;
  current: { attempt_no: number; submitted_at: string | null; is_late: boolean } | null;
  grade: { points: number; feedback: string | null; released_at: string } | null;
  overdue: boolean;
  closed: boolean;
};

/** The student's list. Unreleased grades never leave this function. */
export function buildStudentItems(
  assignments: ReadonlyArray<StudentAssignmentItem["assignment"]>,
  attempts: readonly AttemptWithDetail[],
  now: Date = new Date()
): StudentAssignmentItem[] {
  return assignments.map((a) => {
    const mine = attempts.filter((t) => t.assignment_id === a.id);
    const cur = currentAttempt(mine);
    const released = cur?.grade?.released_at ? cur.grade : null;
    const pastDue = isPastDue(a.due_at, now);
    return {
      assignment: a,
      bucket: studentBucket(cur, released),
      has_draft: !!openDraft(mine),
      attempts: mine.filter((t) => t.status === "submitted").length,
      current: cur ? { attempt_no: cur.attempt_no, submitted_at: cur.submitted_at, is_late: cur.is_late } : null,
      grade: released
        ? { points: Number(released.points), feedback: released.feedback, released_at: released.released_at as string }
        : null,
      overdue: !cur && pastDue,
      closed: pastDue && !a.allow_late,
    };
  });
}
