import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Returns the applications and enrollments currently assigned to the
// authenticated user, plus unread counts (records where staff_viewed_at
// IS NULL). Used by the admin dashboard tiles.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const adminSupabase = createAdminClient();

  const [appsResult, enrollmentsResult] = await Promise.all([
    adminSupabase
      .from("application_responses")
      .select(
        "id, program_id, status, applicant_info, applicant_email, staff_assigned_at, staff_viewed_at, users!application_responses_user_id_fkey(first_name, last_name, preferred_name, email), programs(name, code)"
      )
      .eq("assigned_staff_id", authUser.id)
      .order("staff_assigned_at", { ascending: false })
      .limit(20),
    adminSupabase
      .from("enrollments")
      .select(
        "id, program_id, status, enrolled_at, staff_assigned_at, staff_viewed_at, users!enrollments_user_id_fkey(first_name, last_name, preferred_name, email), programs(name, code)"
      )
      .eq("assigned_staff_id", authUser.id)
      .order("staff_assigned_at", { ascending: false })
      .limit(20),
  ]);

  // Drop applications the user can no longer read — RLS on the user client
  // applies the 6-month expiry lock (migration 223). Identities still come
  // from the admin read above (users-table RLS nulls embedded joins).
  // RLS (migration 304) only returns rows the caller can still open: a
  // current program_staff or program_leaders link, or a schools grant.
  // A stale assigned_staff_id is not enough.
  const [{ data: readable }, { data: readableEnrollments }] = await Promise.all([
    supabase.from("application_responses").select("id").eq("assigned_staff_id", authUser.id),
    supabase.from("enrollments").select("id").eq("assigned_staff_id", authUser.id),
  ]);
  const readableIds = new Set((readable ?? []).map((r) => r.id));
  const readableEnrollmentIds = new Set((readableEnrollments ?? []).map((r) => r.id));
  const apps = (appsResult.data ?? []).filter((a) => readableIds.has(a.id));
  const enrollments = (enrollmentsResult.data ?? []).filter((row) =>
    readableEnrollmentIds.has(row.id)
  );

  const unreadApps = apps.filter(
    (a) => (a as unknown as { staff_viewed_at: string | null }).staff_viewed_at === null
  ).length;
  const unreadEnrollments = enrollments.filter(
    (e) => (e as unknown as { staff_viewed_at: string | null }).staff_viewed_at === null
  ).length;

  return NextResponse.json({
    applications: apps,
    enrollments,
    unread: {
      applications: unreadApps,
      enrollments: unreadEnrollments,
    },
  });
}
