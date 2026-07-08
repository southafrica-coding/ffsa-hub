import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";

// Admin view: how many active applications + active enrollments each staff
// member currently holds. Used to spot lopsided workloads.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const hasAccess = await userCanManageApplications(supabase, authUser.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const adminSupabase = createAdminClient();
  // Cast around auto-generated DB types that don't yet know the new
  // assigned_staff_id column (added in migration 052).
  type InStep = { in: (col: string, vals: unknown[]) => Promise<{ data: unknown }> };
  const sb = adminSupabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        not: (col: string, op: string, val: unknown) => InStep & {
          is: (col: string, val: unknown) => InStep;
        };
      };
    };
  };

  const [appsResult, enrollmentsResult] = await Promise.all([
    sb.from("application_responses")
      .select("assigned_staff_id, status")
      .not("assigned_staff_id", "is", null)
      .in("status", ["submitted", "references_received", "interview_scheduled", "waitlisted"]),
    sb.from("enrollments")
      .select("assigned_staff_id, status")
      .not("assigned_staff_id", "is", null)
      .is("removed_at", null)
      .in("status", ["active", "waiting_for_arrival", "arrived", "on_hold"]),
  ]);

  type Counts = { applications: number; enrollments: number };
  const counts = new Map<string, Counts>();

  for (const row of (appsResult.data as Array<{ assigned_staff_id: string }> | null) ?? []) {
    const c = counts.get(row.assigned_staff_id) ?? { applications: 0, enrollments: 0 };
    c.applications += 1;
    counts.set(row.assigned_staff_id, c);
  }
  for (const row of (enrollmentsResult.data as Array<{ assigned_staff_id: string }> | null) ?? []) {
    const c = counts.get(row.assigned_staff_id) ?? { applications: 0, enrollments: 0 };
    c.enrollments += 1;
    counts.set(row.assigned_staff_id, c);
  }

  const staffIds = Array.from(counts.keys());
  if (staffIds.length === 0) {
    return NextResponse.json({ workload: [] });
  }

  const { data: usersData } = await adminSupabase
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .in("id", staffIds);

  const workload = (usersData ?? []).map((u) => ({
    user: u,
    applications: counts.get(u.id)?.applications ?? 0,
    enrollments: counts.get(u.id)?.enrollments ?? 0,
  }));

  workload.sort(
    (a, b) => b.applications + b.enrollments - (a.applications + a.enrollments)
  );

  return NextResponse.json({ workload });
}
