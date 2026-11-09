// Schools LMS content (slice 1): pure types and helpers shared by the
// service, the API routes, and the client Classroom tab. No database or
// sanitizer imports here, so it stays safe to bundle on the client.
//
// Tables: lms_courses → lms_modules → lms_lessons (migration 305). These
// are not billing_courses (the school's phase / billing "Courses" tab).

export type LmsContentType = "rich_text" | "link";
export const LMS_CONTENT_TYPES: readonly LmsContentType[] = ["rich_text", "link"];

export const LMS_TITLE_MAX = 200;
export const LMS_DESCRIPTION_MAX = 5_000;
export const LMS_BODY_MAX = 100_000;
export const LMS_URL_MAX = 2_000;

export type LmsCourse = {
  id: string;
  program_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LmsModule = {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type LmsLesson = {
  id: string;
  module_id: string;
  title: string;
  content_type: LmsContentType;
  body: string | null;
  link_url: string | null;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
};

export type LmsModuleTree = LmsModule & { lessons: LmsLesson[] };
export type LmsCourseTree = LmsCourse & { modules: LmsModuleTree[] };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ── Ordering ────────────────────────────────────────────────

/** Stable sort by sort_order, then created_at, then id. */
export function bySortOrder<T extends { sort_order: number; created_at?: string; id: string }>(
  rows: T[]
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
      a.id.localeCompare(b.id)
  );
}

/** Next sort_order for a new sibling: one past the current largest. */
export function nextSortOrder(siblings: Array<{ sort_order: number }>): number {
  if (siblings.length === 0) return 0;
  return Math.max(...siblings.map((s) => s.sort_order)) + 1;
}

/**
 * Turn an ordered id list into sort_order updates. The list must be exactly
 * the current siblings (same ids, no duplicates, nothing missing), so a
 * stale client cannot drop or steal rows.
 */
export function buildReorderUpdates(
  currentIds: string[],
  orderedIds: unknown
): Result<Array<{ id: string; sort_order: number }>> {
  if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === "string")) {
    return { ok: false, error: "ids must be a list of ids" };
  }
  const ids = orderedIds as string[];
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "ids contains duplicates" };
  }
  const current = new Set(currentIds);
  if (ids.length !== current.size || !ids.every((id) => current.has(id))) {
    return { ok: false, error: "ids must list every item in this list exactly once" };
  }
  return { ok: true, value: ids.map((id, index) => ({ id, sort_order: index })) };
}

/** Move one id up or down by one place. Returns the same list at the edges. */
export function moveId(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// ── Trees and publish filtering ─────────────────────────────

/** Assemble a sorted course tree. Drafts are dropped unless includeUnpublished. */
export function buildCourseTree(
  course: LmsCourse,
  modules: LmsModule[],
  lessons: LmsLesson[],
  opts: { includeUnpublished: boolean }
): LmsCourseTree | null {
  if (!opts.includeUnpublished && !course.published) return null;
  const ownModules = bySortOrder(modules.filter((m) => m.course_id === course.id)).filter(
    (m) => opts.includeUnpublished || m.published
  );
  return {
    ...course,
    modules: ownModules.map((m) => ({
      ...m,
      lessons: bySortOrder(lessons.filter((l) => l.module_id === m.id)).filter(
        (l) => opts.includeUnpublished || l.published
      ),
    })),
  };
}

/**
 * Students and staff see a lesson only when the lesson, its module, and its
 * course are all published. RLS already enforces this; the app filters again
 * so a policy regression does not leak drafts.
 */
export function publishedOnly(trees: LmsCourseTree[]): LmsCourseTree[] {
  return trees
    .filter((c) => c.published)
    .map((c) => ({
      ...c,
      modules: c.modules
        .filter((m) => m.published)
        .map((m) => ({ ...m, lessons: m.lessons.filter((l) => l.published) })),
    }));
}

// ── Validation ──────────────────────────────────────────────

function cleanTitle(value: unknown): Result<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Title is required" };
  }
  const title = value.trim();
  if (title.length > LMS_TITLE_MAX) {
    return { ok: false, error: `Title must be ${LMS_TITLE_MAX} characters or fewer` };
  }
  return { ok: true, value: title };
}

/** Only absolute http(s) URLs. Returns the normalised href or null. */
export function normaliseLinkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > LMS_URL_MAX) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export type CourseInput = { title: string; description: string | null };
export type CoursePatch = Partial<CourseInput & { published: boolean }>;

export function validateCourseInput(raw: unknown): Result<CourseInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const title = cleanTitle(body.title);
  if (!title.ok) return title;
  const description = cleanDescription(body.description);
  if (!description.ok) return description;
  return { ok: true, value: { title: title.value, description: description.value } };
}

function cleanDescription(value: unknown): Result<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Description must be text" };
  const trimmed = value.trim();
  if (trimmed.length > LMS_DESCRIPTION_MAX) {
    return { ok: false, error: `Description must be ${LMS_DESCRIPTION_MAX} characters or fewer` };
  }
  return { ok: true, value: trimmed || null };
}

function cleanPublished(value: unknown): Result<boolean | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "boolean") return { ok: false, error: "published must be true or false" };
  return { ok: true, value };
}

export function validateCoursePatch(raw: unknown): Result<CoursePatch> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const patch: CoursePatch = {};
  if ("title" in body) {
    const title = cleanTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ("description" in body) {
    const description = cleanDescription(body.description);
    if (!description.ok) return description;
    patch.description = description.value;
  }
  const published = cleanPublished(body.published);
  if (!published.ok) return published;
  if (published.value !== undefined) patch.published = published.value;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: patch };
}

export type ModuleInput = { title: string };
export type ModulePatch = Partial<ModuleInput & { published: boolean }>;

export function validateModuleInput(raw: unknown): Result<ModuleInput> {
  const title = cleanTitle(((raw ?? {}) as Record<string, unknown>).title);
  if (!title.ok) return title;
  return { ok: true, value: { title: title.value } };
}

export function validateModulePatch(raw: unknown): Result<ModulePatch> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const patch: ModulePatch = {};
  if ("title" in body) {
    const title = cleanTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  const published = cleanPublished(body.published);
  if (!published.ok) return published;
  if (published.value !== undefined) patch.published = published.value;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: patch };
}

export type LessonInput = {
  title: string;
  content_type: LmsContentType;
  body: string | null;
  link_url: string | null;
};
export type LessonPatch = Partial<LessonInput & { published: boolean }>;

/** Content fields for one content_type; the other field is cleared. */
function cleanLessonContent(
  contentType: unknown,
  body: unknown,
  linkUrl: unknown
): Result<Pick<LessonInput, "content_type" | "body" | "link_url">> {
  if (contentType === "rich_text") {
    if (typeof body !== "string" || body.trim() === "") {
      return { ok: false, error: "A text lesson needs some text" };
    }
    if (body.length > LMS_BODY_MAX) {
      return { ok: false, error: "Lesson text is too long" };
    }
    return { ok: true, value: { content_type: "rich_text", body, link_url: null } };
  }
  if (contentType === "link") {
    const href = normaliseLinkUrl(linkUrl);
    if (!href) return { ok: false, error: "A link lesson needs a full http(s) URL" };
    return { ok: true, value: { content_type: "link", body: null, link_url: href } };
  }
  return { ok: false, error: "content_type must be rich_text or link" };
}

export function validateLessonInput(raw: unknown): Result<LessonInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const title = cleanTitle(body.title);
  if (!title.ok) return title;
  const content = cleanLessonContent(body.content_type, body.body, body.link_url);
  if (!content.ok) return content;
  return { ok: true, value: { title: title.value, ...content.value } };
}

/**
 * A lesson patch. Changing content needs the full content for the resulting
 * type (content_type plus body or link_url), so the row always satisfies the
 * table's CHECK.
 */
export function validateLessonPatch(raw: unknown): Result<LessonPatch> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const patch: LessonPatch = {};
  if ("title" in body) {
    const title = cleanTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ("content_type" in body || "body" in body || "link_url" in body) {
    const content = cleanLessonContent(body.content_type, body.body, body.link_url);
    if (!content.ok) return content;
    Object.assign(patch, content.value);
  }
  const published = cleanPublished(body.published);
  if (!published.ok) return published;
  if (published.value !== undefined) patch.published = published.value;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, value: patch };
}

// ── Access ──────────────────────────────────────────────────

export type LmsAccess = {
  /** Create / edit / delete / publish, and see drafts. */
  canEdit: boolean;
  /** See published content only (program staff, enrolled students). */
  canReadPublished: boolean;
};

export function deriveLmsAccess(input: {
  canManage: boolean;
  isStaff: boolean;
  isEnrolled: boolean;
}): LmsAccess {
  return {
    canEdit: input.canManage,
    canReadPublished: input.canManage || input.isStaff || input.isEnrolled,
  };
}

/** Statuses that keep a student in the classroom. Matches lms_is_enrolled(). */
export const LMS_EXCLUDED_ENROLLMENT_STATUSES = ["dismissed", "decided_to_leave"] as const;

export function isClassroomEnrollment(e: { status: string; removed_at: string | null }): boolean {
  return (
    !e.removed_at &&
    !(LMS_EXCLUDED_ENROLLMENT_STATUSES as readonly string[]).includes(e.status)
  );
}
