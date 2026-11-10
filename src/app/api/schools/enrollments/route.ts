import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  programIdsForTargets,
  userCanManageEveryProgram,
} from "@/lib/auth/check-schools-access";
import { deactivateMembershipProfile } from "@/lib/auth/membership-roles";
import { lmsRestrictMessage } from "@/lib/schools/lms-assignments-auth";
import {
  createEnrollment,
  updateEnrollmentStatus,
  setEnrollmentRemoved,
  deleteEnrollment,
} from "@/services/schools";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { user_id, program_id, notes } = body;

  if (!user_id || !program_id) {
    return NextResponse.json(
      { error: "user_id and program_id are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createEnrollment(supabase, {
    user_id,
    program_id,
    enrolled_by: user.id,
    notes: notes || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, enrollment: data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, status } = body;
  const ids = targetIds(body);

  if (!id || !status || !ids) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  // Dismissing switches the student's Hub login off, so it needs the same
  // schools-admin / program-leader rights as removing from the roster.
  // Waiting/Arrived stay open to anyone who can work the Arrival tab.
  // Every enrollment in the batch has to be in a program this person manages.
  if (status === "dismissed") {
    const denied = await denyUnlessEnrollmentPrograms(supabase, user.id, ids);
    if (denied) return denied;
  }

  const { data, error } = await updateEnrollmentStatus(supabase, id, status);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A dismissed student is deactivated. Guarded in the helper so staff/admin
  // accounts are never touched.
  if (status === "dismissed" && data?.user_id) {
    const admin = createAdminClient();
    await deactivateMembershipProfile(admin, data.user_id, "enrollment_dismissed");
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "dismiss_enrollment",
      resource_type: "enrollments",
      resource_id: id,
    });
  }

  return NextResponse.json({ success: true, enrollment: data });
}

// Reversibly remove a student from the roster, or restore a removed one.
// Body: { id, removed: boolean }
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, removed } = body as { id?: string; removed?: boolean; ids?: unknown };
  const ids = targetIds(body);

  if (!id || typeof removed !== "boolean" || !ids) {
    return NextResponse.json(
      { error: "id and removed (boolean) are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const denied = await denyUnlessEnrollmentPrograms(supabase, user.id, ids);
  if (denied) return denied;

  const { data, error } = await setEnrollmentRemoved(
    admin,
    id,
    removed ? user.id : null
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: removed ? "remove_enrollment" : "restore_enrollment",
    resource_type: "enrollments",
    resource_id: id,
  });

  return NextResponse.json({ success: true, enrollment: data });
}

// Permanently delete an enrollment. Only allowed once it has been removed,
// so the remove step always acts as a buffer. Cascades grades/fees; the
// student's Hub account is untouched.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = body as { id?: string };
  const ids = targetIds(body);

  if (!id || !ids) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const denied = await denyUnlessEnrollmentPrograms(supabase, user.id, ids);
  if (denied) return denied;

  const { data: existing, error: fetchError } = await admin
    .from("enrollments")
    .select("id, removed_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
  }

  if (!existing.removed_at) {
    return NextResponse.json(
      { error: "Remove the student from the school before deleting permanently." },
      { status: 409 }
    );
  }

  const { error } = await deleteEnrollment(admin, id);

  if (error) {
    // Classroom submissions hold the enrolment (migration 310, RESTRICT).
    const restrict = lmsRestrictMessage(error, "enrollment");
    if (restrict) return NextResponse.json({ error: restrict }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "delete_enrollment",
    resource_type: "enrollments",
    resource_id: id,
  });

  return NextResponse.json({ success: true });
}

/**
 * `id` is the enrollment the handler writes. `ids`, when the body sends it,
 * is check-only: every id has to belong to a program this user manages, and
 * a bad entry rejects the request. Nothing in `ids` is written.
 */
function targetIds(body: { id?: unknown; ids?: unknown }): string[] | null {
  const ids: string[] = [];
  if (typeof body.id === "string" && body.id.length > 0) ids.push(body.id);
  if (Array.isArray(body.ids)) {
    for (const id of body.ids) {
      if (typeof id !== "string" || id.length === 0) return null;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids.length > 0 ? ids : null;
}

async function denyUnlessEnrollmentPrograms(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: string[]
) {
  const programs = await programIdsForTargets(createAdminClient(), "enrollments", ids);
  if (!programs || !(await userCanManageEveryProgram(supabase, userId, programs))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return null;
}
