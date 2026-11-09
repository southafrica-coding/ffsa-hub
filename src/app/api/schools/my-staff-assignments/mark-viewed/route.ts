import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Marks the caller's currently-unread assignments as viewed. With no body,
// marks all of the caller's unread assignments as viewed (clears the badge).
// With ids, marks only those.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { application_ids?: string[]; enrollment_ids?: string[]; all?: boolean } = { all: true };
  try {
    body = await request.json();
  } catch {
    // Empty body — treat as mark-all.
    body = { all: true };
  }

  const adminSupabase = createAdminClient();
  const nowIso = new Date().toISOString();
  const [{ data: visibleApps }, { data: visibleEnrollments }] = await Promise.all([
    supabase.from("application_responses").select("id").eq("assigned_staff_id", authUser.id),
    supabase.from("enrollments").select("id").eq("assigned_staff_id", authUser.id),
  ]);
  const visibleAppIds = new Set((visibleApps ?? []).map((row) => row.id));
  const visibleEnrollmentIds = new Set((visibleEnrollments ?? []).map((row) => row.id));
  // Cast around auto-generated DB types that don't yet know about the new
  // staff_viewed_at / assigned_staff_id columns (added in migration 052).
  const sb = adminSupabase as unknown as {
    from: (table: string) => {
      update: (values: Record<string, unknown>) => {
        eq: (col: string, val: unknown) => {
          is: (col: string, val: unknown) => Promise<unknown>;
          in: (col: string, vals: unknown[]) => Promise<unknown>;
        };
      };
    };
  };

  if (body.all || (!body.application_ids?.length && !body.enrollment_ids?.length)) {
    await Promise.all([
      visibleAppIds.size
        ? sb.from("application_responses")
            .update({ staff_viewed_at: nowIso })
            .eq("assigned_staff_id", authUser.id)
            .in("id", [...visibleAppIds])
        : Promise.resolve(),
      visibleEnrollmentIds.size
        ? sb.from("enrollments")
            .update({ staff_viewed_at: nowIso })
            .eq("assigned_staff_id", authUser.id)
            .in("id", [...visibleEnrollmentIds])
        : Promise.resolve(),
    ]);
    return NextResponse.json({ success: true });
  }

  const ops: Promise<unknown>[] = [];
  const requestedApps = (body.application_ids ?? []).filter((id) => visibleAppIds.has(id));
  const requestedEnrollments = (body.enrollment_ids ?? []).filter((id) =>
    visibleEnrollmentIds.has(id)
  );
  if (requestedApps.length) {
    ops.push(
      sb.from("application_responses")
        .update({ staff_viewed_at: nowIso })
        .eq("assigned_staff_id", authUser.id)
        .in("id", requestedApps)
    );
  }
  if (requestedEnrollments.length) {
    ops.push(
      sb.from("enrollments")
        .update({ staff_viewed_at: nowIso })
        .eq("assigned_staff_id", authUser.id)
        .in("id", requestedEnrollments)
    );
  }
  await Promise.all(ops);

  return NextResponse.json({ success: true });
}
