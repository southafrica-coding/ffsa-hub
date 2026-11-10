import type { SupabaseClient } from "@supabase/supabase-js";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { userIsProgramStaff } from "@/lib/schools/program-staff-access";
import {
  buildCourseTree,
  bySortOrder,
  deriveLmsAccess,
  isClassroomEnrollment,
  nextSortOrder,
  publishedOnly,
  type CourseInput,
  type CoursePatch,
  type LessonInput,
  type LessonPatch,
  type LmsAccess,
  type LmsCourse,
  type LmsCourseTree,
  type LmsLesson,
  type LmsModule,
  type ModuleInput,
  type ModulePatch,
} from "@/lib/schools/lms-content";

// Schools LMS content (migration 305). Always called with the signed-in
// user's client: RLS on lms_* is the second gate behind the route checks.
// Not billing_courses — that is the school's phase / billing Courses tab.

// lms_* tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient | any;
type DbError = { message: string } | null;
type DbResult<T> = { data: T | null; error: DbError };

// ── Access ──────────────────────────────────────────────────

export async function userHasClassroomEnrollment(
  supabase: Client,
  userId: string,
  programId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("status, removed_at")
    .eq("program_id", programId)
    .eq("user_id", userId);
  if (error || !data) return false;
  return (data as Array<{ status: string; removed_at: string | null }>).some(isClassroomEnrollment);
}

export async function resolveLmsAccess(
  supabase: Client,
  userId: string,
  programId: string
): Promise<LmsAccess> {
  const [canManage, isStaff, isEnrolled] = await Promise.all([
    userCanManageProgram(supabase, userId, programId),
    userIsProgramStaff(supabase, userId, programId),
    userHasClassroomEnrollment(supabase, userId, programId),
  ]);
  return deriveLmsAccess({ canManage, isStaff, isEnrolled });
}

// ── Ownership lookups (route params must agree with the row) ──

export async function programIdForCourse(supabase: Client, courseId: string): Promise<string | null> {
  const { data } = await supabase.from("lms_courses").select("program_id").eq("id", courseId).maybeSingle();
  return (data as { program_id: string } | null)?.program_id ?? null;
}

export async function courseIdForModule(supabase: Client, moduleId: string): Promise<string | null> {
  const { data } = await supabase.from("lms_modules").select("course_id").eq("id", moduleId).maybeSingle();
  return (data as { course_id: string } | null)?.course_id ?? null;
}

export async function programIdForModule(supabase: Client, moduleId: string): Promise<string | null> {
  const courseId = await courseIdForModule(supabase, moduleId);
  return courseId ? programIdForCourse(supabase, courseId) : null;
}

export async function programIdForLesson(supabase: Client, lessonId: string): Promise<string | null> {
  const { data } = await supabase.from("lms_lessons").select("module_id").eq("id", lessonId).maybeSingle();
  const moduleId = (data as { module_id: string } | null)?.module_id;
  return moduleId ? programIdForModule(supabase, moduleId) : null;
}

// ── Reads ───────────────────────────────────────────────────

export async function listCoursesForProgram(
  supabase: Client,
  programId: string,
  opts: { includeUnpublished: boolean }
): Promise<DbResult<LmsCourse[]>> {
  let query = supabase.from("lms_courses").select("*").eq("program_id", programId);
  if (!opts.includeUnpublished) query = query.eq("published", true);
  const { data, error } = await query.order("sort_order", { ascending: true });
  if (error) return { data: null, error };
  return { data: bySortOrder((data ?? []) as LmsCourse[]), error: null };
}

async function loadTrees(
  supabase: Client,
  courses: LmsCourse[],
  opts: { includeUnpublished: boolean }
): Promise<DbResult<LmsCourseTree[]>> {
  if (courses.length === 0) return { data: [], error: null };
  let modulesQuery = supabase
    .from("lms_modules")
    .select("*")
    .in("course_id", courses.map((c) => c.id));
  if (!opts.includeUnpublished) modulesQuery = modulesQuery.eq("published", true);
  const { data: modules, error: modulesError } = await modulesQuery;
  if (modulesError) return { data: null, error: modulesError };

  const moduleIds = ((modules ?? []) as LmsModule[]).map((m) => m.id);
  let lessons: LmsLesson[] = [];
  if (moduleIds.length > 0) {
    let lessonsQuery = supabase.from("lms_lessons").select("*").in("module_id", moduleIds);
    if (!opts.includeUnpublished) lessonsQuery = lessonsQuery.eq("published", true);
    const { data, error } = await lessonsQuery;
    if (error) return { data: null, error };
    lessons = (data ?? []) as LmsLesson[];
  }

  const trees = courses
    .map((c) => buildCourseTree(c, (modules ?? []) as LmsModule[], lessons, opts))
    .filter((t): t is LmsCourseTree => t !== null);
  return { data: opts.includeUnpublished ? trees : publishedOnly(trees), error: null };
}

export async function getCourseTree(
  supabase: Client,
  courseId: string,
  opts: { includeUnpublished: boolean }
): Promise<DbResult<LmsCourseTree>> {
  const { data: course, error } = await supabase
    .from("lms_courses")
    .select("*")
    .eq("id", courseId)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!course) return { data: null, error: null };
  const trees = await loadTrees(supabase, [course as LmsCourse], opts);
  if (trees.error) return { data: null, error: trees.error };
  return { data: trees.data?.[0] ?? null, error: null };
}

/** Every course in a program, with modules and lessons. Students: published only. */
export async function getProgramClassroom(
  supabase: Client,
  programId: string,
  opts: { includeUnpublished: boolean }
): Promise<DbResult<LmsCourseTree[]>> {
  const courses = await listCoursesForProgram(supabase, programId, opts);
  if (courses.error) return { data: null, error: courses.error };
  return loadTrees(supabase, courses.data ?? [], opts);
}

// ── Writes ──────────────────────────────────────────────────

async function siblingOrders(
  supabase: Client,
  table: "lms_courses" | "lms_modules" | "lms_lessons",
  parentColumn: "program_id" | "course_id" | "module_id",
  parentId: string
): Promise<Array<{ sort_order: number }>> {
  const { data } = await supabase.from(table).select("sort_order").eq(parentColumn, parentId);
  return (data ?? []) as Array<{ sort_order: number }>;
}

export async function createCourse(
  supabase: Client,
  programId: string,
  input: CourseInput,
  createdBy: string
): Promise<DbResult<LmsCourse>> {
  const sort_order = nextSortOrder(await siblingOrders(supabase, "lms_courses", "program_id", programId));
  return supabase
    .from("lms_courses")
    .insert({ program_id: programId, ...input, sort_order, created_by: createdBy })
    .select("*")
    .single();
}

export async function updateCourse(
  supabase: Client,
  courseId: string,
  patch: CoursePatch
): Promise<DbResult<LmsCourse>> {
  return supabase.from("lms_courses").update(patch).eq("id", courseId).select("*").maybeSingle();
}

export async function deleteCourse(supabase: Client, courseId: string): Promise<{ error: DbError }> {
  const { error } = await supabase.from("lms_courses").delete().eq("id", courseId);
  return { error };
}

export async function createModule(
  supabase: Client,
  courseId: string,
  input: ModuleInput
): Promise<DbResult<LmsModule>> {
  const sort_order = nextSortOrder(await siblingOrders(supabase, "lms_modules", "course_id", courseId));
  return supabase
    .from("lms_modules")
    .insert({ course_id: courseId, ...input, sort_order })
    .select("*")
    .single();
}

export async function updateModule(
  supabase: Client,
  moduleId: string,
  patch: ModulePatch
): Promise<DbResult<LmsModule>> {
  return supabase.from("lms_modules").update(patch).eq("id", moduleId).select("*").maybeSingle();
}

export async function deleteModule(supabase: Client, moduleId: string): Promise<{ error: DbError }> {
  const { error } = await supabase.from("lms_modules").delete().eq("id", moduleId);
  return { error };
}

export async function createLesson(
  supabase: Client,
  moduleId: string,
  input: LessonInput
): Promise<DbResult<LmsLesson>> {
  const sort_order = nextSortOrder(await siblingOrders(supabase, "lms_lessons", "module_id", moduleId));
  return supabase
    .from("lms_lessons")
    .insert({ module_id: moduleId, ...input, sort_order })
    .select("*")
    .single();
}

export async function updateLesson(
  supabase: Client,
  lessonId: string,
  patch: LessonPatch
): Promise<DbResult<LmsLesson>> {
  return supabase.from("lms_lessons").update(patch).eq("id", lessonId).select("*").maybeSingle();
}

export async function deleteLesson(supabase: Client, lessonId: string): Promise<{ error: DbError }> {
  const { error } = await supabase.from("lms_lessons").delete().eq("id", lessonId);
  return { error };
}

/** Publish or unpublish one row. */
export async function setPublished(
  supabase: Client,
  kind: "course" | "module" | "lesson",
  id: string,
  published: boolean
): Promise<{ error: DbError }> {
  const table = kind === "course" ? "lms_courses" : kind === "module" ? "lms_modules" : "lms_lessons";
  const { error } = await supabase.from(table).update({ published }).eq("id", id);
  return { error };
}

/** Current sibling ids, for validating a reorder request. */
export async function siblingIds(
  supabase: Client,
  table: "lms_courses" | "lms_modules" | "lms_lessons",
  parentColumn: "program_id" | "course_id" | "module_id",
  parentId: string
): Promise<DbResult<string[]>> {
  const { data, error } = await supabase.from(table).select("id").eq(parentColumn, parentId);
  if (error) return { data: null, error };
  return { data: ((data ?? []) as Array<{ id: string }>).map((r) => r.id), error: null };
}

/** Write sort_order for each sibling. Updates are scoped to the parent too. */
export async function applyReorder(
  supabase: Client,
  table: "lms_courses" | "lms_modules" | "lms_lessons",
  parentColumn: "program_id" | "course_id" | "module_id",
  parentId: string,
  updates: Array<{ id: string; sort_order: number }>
): Promise<{ error: DbError }> {
  const results = await Promise.all(
    updates.map((u) =>
      supabase.from(table).update({ sort_order: u.sort_order }).eq("id", u.id).eq(parentColumn, parentId)
    )
  );
  const failed = results.find((r: { error: DbError }) => r.error);
  return { error: failed?.error ?? null };
}
