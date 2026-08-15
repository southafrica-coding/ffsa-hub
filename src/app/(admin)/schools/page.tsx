import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getPrograms } from "@/services/schools";
import { Masthead, NeedsYou, NeedsYouAction, Chip } from "@/components/ffsa";
import { ProgramsTable, type ProgramStats } from "./programs-table";
import { ApplicantPipeline, type NextIntake, type PipelineRow } from "./applicant-pipeline";
import { CreateProgramForm } from "./create-program-form";

const VIEWS = [
  ["active", "Active"],
  ["archived", "Archived"],
] as const;

// Enrolment lifecycle (migration 032), mirrored from the dashboard analytics
// route so "students" means the same number in both places: on the roster now
// or finished. Students who left are not counted.
const ENROLLED_STATUSES = ["waiting_for_arrival", "arrived", "graduated"];

// Applications nobody has decided on yet. These drive the page's one yellow
// band and the pipeline column — everything else has already been actioned.
const AWAITING_STATUSES = [
  "submitted",
  "waiting_for_references",
  "references_received",
  "interview_scheduled",
];

// How many applicants the pipeline column lists before it stops. The band
// above it carries the true total, so the column can stay a readable length.
const PIPELINE_LIMIT = 8;

const DAY_MS = 86_400_000;

type CourseRow = {
  program_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
};

type ApplicantInfo = { first_name?: string; last_name?: string } | null;

type UserIdentity = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export default async function SchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await createClient();
  // Middleware already validated; read session from cookie.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  const params = await searchParams;
  const statusFilter = params.status || "active";

  // Permission check + programs fetch are independent — run together.
  const [, programsResult] = await Promise.all([
    requireModuleAccess(supabase, user.id, "schools"),
    getPrograms(supabase, { status: statusFilter }),
  ]);
  const { data: programs, error, count } = programsResult;

  if (error) {
    console.error("getPrograms error:", JSON.stringify(error, null, 2));
  }

  const rows = programs ?? [];
  const ids: string[] = rows.map((p: { id: string }) => p.id);
  const has = ids.length > 0;

  // billing_courses and program_leaders are absent from the generated Database
  // types (the program page casts for the same reason), and the embedded
  // identity join widens the application row past what the typed client infers.
  // Same loose-client convention as src/services/schools.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Everything below is scoped to the programs already on screen, so no panel
  // can contradict the chosen filter — and all four reads go through the
  // RLS-scoped client, so a viewer only ever tallies schools they can see.
  const [coursesResult, enrolResult, leadersResult, applicationsResult] =
    await Promise.all([
      has
        ? db
            .from("billing_courses")
            .select("program_id, name, start_date, end_date")
            .in("program_id", ids)
            .neq("status", "archived")
            .order("sequence", { ascending: true })
        : null,
      has
        ? db
            .from("enrollments")
            .select("program_id, status")
            .in("program_id", ids)
            .is("removed_at", null)
        : null,
      has
        ? db.from("program_leaders").select("program_id").in("program_id", ids)
        : null,
      has
        ? db
            .from("application_responses")
            .select(
              "id, program_id, status, submitted_at, admin_notes, applicant_email, applicant_info, " +
                "users!application_responses_user_id_fkey(first_name, last_name, preferred_name)",
              { count: "exact" }
            )
            .in("program_id", ids)
            .in("status", AWAITING_STATUSES)
            .is("removed_at", null)
            // Oldest first: the applications that have waited longest are the
            // ones actually needing a decision.
            .order("submitted_at", { ascending: true })
            .limit(PIPELINE_LIMIT)
        : null,
    ]);

  const courses = (coursesResult?.data ?? []) as CourseRow[];
  const programNames = new Map<string, string>(
    rows.map((p: { id: string; name: string }) => [p.id, p.name])
  );

  const students = new Map<string, number>();
  for (const row of (enrolResult?.data ?? []) as { program_id: string; status: string }[]) {
    if (!ENROLLED_STATUSES.includes(row.status)) continue;
    students.set(row.program_id, (students.get(row.program_id) ?? 0) + 1);
  }

  const staff = new Map<string, number>();
  for (const row of (leadersResult?.data ?? []) as { program_id: string }[]) {
    staff.set(row.program_id, (staff.get(row.program_id) ?? 0) + 1);
  }

  const stats: Record<string, ProgramStats> = {};
  for (const id of ids) {
    stats[id] = {
      students: students.get(id) ?? 0,
      staff: staff.get(id) ?? 0,
      term: termProgress(courses.filter((c) => c.program_id === id)),
    };
  }

  const awaiting = applicationsResult?.count ?? 0;
  const pipeline: PipelineRow[] = (applicationsResult?.data ?? []).map(
    (r: {
      id: string;
      program_id: string;
      status: string;
      submitted_at: string | null;
      admin_notes: string | null;
      applicant_email: string | null;
      applicant_info: ApplicantInfo;
      // The embedded join is nulled by RLS for viewers who can't read other
      // users' rows; applicant_info/applicant_email carry public applicants.
      users: UserIdentity | UserIdentity[] | null;
    }) => ({
      id: r.id,
      programId: r.program_id,
      programName: programNames.get(r.program_id) ?? "—",
      name: applicantName(r),
      status: r.status,
      note: r.admin_notes,
      submittedAt: r.submitted_at,
    })
  );

  // Only offer a "review" destination when the band and the column are looking
  // at exactly the same, single school — with more schools in play (or more
  // applications than the column lists) there is no one right place to send you.
  const awaitingProgramIds = new Set(pipeline.map((r) => r.programId));
  const reviewHref =
    awaitingProgramIds.size === 1 && awaiting === pipeline.length
      ? `/schools/${[...awaitingProgramIds][0]}?tab=applicants`
      : null;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Operations · ${count ?? rows.length} ${
          statusFilter === "archived" ? "archived " : ""
        }${(count ?? rows.length) === 1 ? "school" : "schools"}`}
        title="Training"
        actions={<CreateProgramForm />}
      />

      {/* The page's ONE yellow band. Never add a second. */}
      {awaiting > 0 && (
        <NeedsYou
          action={reviewHref && <NeedsYouAction href={reviewHref}>Review</NeedsYouAction>}
        >
          {awaiting === 1
            ? "1 application is waiting on a decision"
            : `${awaiting} applications are waiting on a decision`}
        </NeedsYou>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-8 py-3">
        {VIEWS.map(([key, label]) => (
          <Link key={key} href={`/schools${key === "active" ? "" : `?status=${key}`}`}>
            <Chip active={statusFilter === key}>{label}</Chip>
          </Link>
        ))}
      </div>

      <div className="px-8 py-7">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_380px]">
          <ProgramsTable
            programs={rows}
            statusFilter={statusFilter}
            stats={stats}
          />
          <ApplicantPipeline
            rows={pipeline}
            total={awaiting}
            nextIntake={nextIntake(courses, programNames)}
          />
        </div>
      </div>
    </div>
  );
}

/** Display name, in the order the applicants tab resolves it. */
function applicantName(r: {
  applicant_info: ApplicantInfo;
  applicant_email: string | null;
  users: UserIdentity | UserIdentity[] | null;
}) {
  // supabase-js infers this embed as object-or-array inconsistently; the
  // dashboard's registrations card normalises the same way.
  const u = Array.isArray(r.users) ? r.users[0] : r.users;
  if (u) {
    const name = `${u.preferred_name ?? u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
    if (name) return name;
  }
  if (r.applicant_info) {
    const name = `${r.applicant_info.first_name ?? ""} ${r.applicant_info.last_name ?? ""}`.trim();
    if (name) return name;
  }
  return r.applicant_email ?? "—";
}

/**
 * Term progress for a school, derived from its dated courses: the term runs
 * from the earliest course start to the latest course end, and the phase is
 * whichever course contains today. A school with no dated courses gets nulls
 * and its row simply shows nothing — an undated term is not a term at 0%.
 */
function termProgress(courses: CourseRow[]): ProgramStats["term"] {
  const dated = courses.filter((c) => c.start_date && c.end_date);
  if (dated.length === 0) return null;

  const starts = dated.map((c) => Date.parse(`${c.start_date}T00:00:00`));
  const ends = dated.map((c) => Date.parse(`${c.end_date}T00:00:00`));
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  if (!(end > start)) return null;

  const now = Date.now();
  const pct = Math.round(((now - start) / (end - start)) * 100);
  const current = dated.find(
    (c) =>
      Date.parse(`${c.start_date}T00:00:00`) <= now &&
      Date.parse(`${c.end_date}T00:00:00`) >= now
  );

  return {
    pct: Math.min(100, Math.max(0, pct)),
    phase: current?.name ?? null,
    // Only meaningful once the term has started; before that there is no week.
    week: now >= start && now <= end ? Math.floor((now - start) / DAY_MS / 7) + 1 : null,
  };
}

/** The next course that has not started yet, across the schools on screen. */
function nextIntake(
  courses: CourseRow[],
  programNames: Map<string, string>
): NextIntake {
  const today = new Date().toISOString().split("T")[0];
  const upcoming = courses
    .filter((c) => c.start_date && c.start_date > today)
    .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));
  const next = upcoming[0];
  if (!next) return null;

  return {
    courseName: next.name,
    programName: programNames.get(next.program_id) ?? "—",
    startDate: next.start_date!,
    daysAway: Math.max(
      0,
      Math.round((Date.parse(`${next.start_date}T00:00:00`) - Date.now()) / DAY_MS)
    ),
  };
}
