import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasModuleAccess } from "@/lib/require-permission";
import { userCanManageApplications, userCanManageProgram } from "@/lib/auth/check-schools-access";
import { loadTrackPipeline } from "@/lib/schools/track-pipeline";
import { gradedCoursesForStudent, type QueueCourse, type TrackScope } from "@/lib/schools/lms-api";

export type ClassroomProgram = { id: string; name: string; code: string };

export type ClassroomCourse = {
  id: string;
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

export type ClassroomPerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export type QueueStudent = {
  enrollmentId: string;
  name: string;
  courses: QueueCourse[];
};

const COLUMN_SETS = [
  "id, code, name, description, notes, scope, sequence, status, start_date, end_date, arrival_date, credit_hours, graded, lead_staff_id",
  "id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, credit_hours, graded, lead_staff_id",
  "id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, credit_hours, lead_staff_id",
  "id, code, name, description, scope, sequence, status, start_date, end_date, arrival_date, lead_staff_id",
];

function personName(person: ClassroomPerson | undefined): string {
  if (!person) return "Unknown";
  const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
  return name || person.email || "Unknown";
}

function asCourse(row: Record<string, unknown>): ClassroomCourse {
  const scope = row.scope === "full_program" ? "full_program" : "segment";
  const status = ["upcoming", "active", "completed", "archived"].includes(String(row.status))
    ? (row.status as ClassroomCourse["status"])
    : "upcoming";
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    scope,
    sequence: typeof row.sequence === "number" ? row.sequence : 0,
    status,
    start_date: typeof row.start_date === "string" ? row.start_date : null,
    end_date: typeof row.end_date === "string" ? row.end_date : null,
    arrival_date: typeof row.arrival_date === "string" ? row.arrival_date : null,
    credit_hours: typeof row.credit_hours === "number" ? row.credit_hours : 0,
    graded: row.graded !== false,
    lead_staff_id: typeof row.lead_staff_id === "string" ? row.lead_staff_id : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readCourses(supabase: any, programId: string, courseId?: string) {
  let last: { data: unknown; error: { code?: string } | null } = { data: null, error: null };
  for (const columns of COLUMN_SETS) {
    let query = supabase.from("billing_courses").select(columns).eq("program_id", programId);
    if (courseId) query = query.eq("id", courseId);
    else query = query.order("sequence", { ascending: true }).order("name", { ascending: true });
    last = courseId ? await query.maybeSingle() : await query;
    if (!last.error) return last;
    if (last.error.code !== "42703" && last.error.code !== "PGRST204") return last;
  }
  return last;
}

export async function requireClassroom(programId: string) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) redirect("/login");
  if (!(await hasModuleAccess(supabase, session.user.id, "schools"))) redirect("/dashboard");
  if (!(await userCanManageProgram(supabase, session.user.id, programId))) {
    redirect(`/schools/${programId}`);
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, code")
    .eq("id", programId)
    .maybeSingle();
  if (!program) notFound();

  const canSaveBaseWide = await userCanManageApplications(supabase, session.user.id);
  return {
    supabase,
    userId: session.user.id,
    program: program as ClassroomProgram,
    canSaveBaseWide,
  };
}

export async function loadClassroomCourses(programId: string) {
  const supabase = await createClient();
  const result = await readCourses(supabase, programId);
  if (result.error || !Array.isArray(result.data)) return [] as ClassroomCourse[];
  return (result.data as Record<string, unknown>[]).map(asCourse);
}

export async function loadClassroomCourse(programId: string, courseId: string) {
  const supabase = await createClient();
  const result = await readCourses(supabase, programId, courseId);
  if (result.error || !result.data || Array.isArray(result.data)) return null;
  return asCourse(result.data as Record<string, unknown>);
}

export async function loadPeople(): Promise<ClassroomPerson[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, email")
    .eq("is_active", true)
    .order("first_name", { ascending: true })
    .limit(500);
  return (data ?? []) as ClassroomPerson[];
}

export async function loadGradingQueue(programId: string): Promise<{
  students: QueueStudent[];
  courses: QueueCourse[];
  official: Array<{ enrollmentId: string; courseId: string; letter: string | null }>;
}> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const courses = (await loadClassroomCourses(programId)).map((course) => ({
    id: course.id,
    code: course.code,
    name: course.name,
    sequence: course.sequence,
    graded: course.graded,
  }));

  // enrollment_segments and billing_courses are newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enrollments } = await (supabase as any)
    .from("enrollments")
    .select("id, user_id, removed_at, enrollment_segments(billing_course_id, billing_courses(code))")
    .eq("program_id", programId)
    .is("removed_at", null);

  const rows = (enrollments ?? []) as Array<{
    id: string;
    user_id: string | null;
    enrollment_segments: Array<{
      billing_course_id: string | null;
      billing_courses: { code: string } | { code: string }[] | null;
    }> | null;
  }>;

  const userIds = rows.map((row) => row.user_id).filter((id): id is string => !!id);
  const names = new Map<string, ClassroomPerson>();
  if (userIds.length > 0) {
    const { data: users } = await admin
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", userIds);
    for (const user of (users ?? []) as ClassroomPerson[]) names.set(user.id, user);
  }

  const pipeline = await loadTrackPipeline(admin, programId);
  const trackByEnrollment = new Map<string, TrackScope>();
  for (const person of pipeline.people) {
    if (person.enrollmentId) trackByEnrollment.set(person.enrollmentId, person.track);
  }

  const students: QueueStudent[] = rows
    .map((row) => {
      const segments = (row.enrollment_segments ?? []).map((segment) => {
        const embedded = segment.billing_courses;
        const code = Array.isArray(embedded) ? embedded[0]?.code ?? null : embedded?.code ?? null;
        return { billing_course_id: segment.billing_course_id, code };
      });
      return {
        enrollmentId: row.id,
        name: personName(row.user_id ? names.get(row.user_id) : undefined),
        courses: gradedCoursesForStudent(courses, segments, trackByEnrollment.get(row.id) ?? null),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const enrollmentIds = students.map((student) => student.enrollmentId);
  const official: Array<{ enrollmentId: string; courseId: string; letter: string | null }> = [];
  for (let i = 0; i < enrollmentIds.length; i += 200) {
    const slice = enrollmentIds.slice(i, i + 200);
    if (slice.length === 0) continue;
    const { data: grades } = await supabase
      .from("grades")
      .select("enrollment_id, course_id, letter_grade")
      .in("enrollment_id", slice);
    for (const grade of grades ?? []) {
      official.push({
        enrollmentId: grade.enrollment_id,
        courseId: grade.course_id,
        letter: grade.letter_grade,
      });
    }
  }

  return { students, courses: courses.filter((course) => course.graded), official };
}
