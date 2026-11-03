import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getMyDirectPermissions,
  getMyProfileRow,
  getMyRoleAssignments,
  getRoleBundles,
} from "@/services/me";
import {
  buildMePayload,
  type DirectPermissionRow,
  type ProfileRow,
  type RoleAssignmentRow,
  type RoleBundleRow,
} from "@/lib/me";

// Who am I, and what may I do? The phone app calls this after sign-in and
// on resume (bearer token); the website can call it too (cookies). Only the
// caller's own rows, read through their own RLS client. Contract: src/lib/me.ts.

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const [profile, assignments, direct] = await Promise.all([
    getMyProfileRow(supabase, user.id),
    getMyRoleAssignments(supabase, user.id),
    getMyDirectPermissions(supabase, user.id),
  ]);
  const firstError = profile.error ?? assignments.error ?? direct.error;
  if (firstError) {
    return NextResponse.json(
      { error: "server_error", message: firstError.message },
      { status: 500, headers: NO_STORE }
    );
  }

  const profileRow = profile.data as ProfileRow | null;
  // The middleware already refuses deactivated accounts; this is the
  // backstop for any path that skips it.
  if (profileRow?.is_active === false) {
    return NextResponse.json(
      {
        error: "deactivated",
        message: "This account has been deactivated. Contact an administrator.",
      },
      { status: 403, headers: NO_STORE }
    );
  }

  const assignmentRows = (assignments.data ?? []) as RoleAssignmentRow[];
  const roleIds = [...new Set(assignmentRows.map((a) => a.role_id))];
  const bundles = await getRoleBundles(supabase, roleIds);
  if (bundles.error) {
    return NextResponse.json(
      { error: "server_error", message: bundles.error.message },
      { status: 500, headers: NO_STORE }
    );
  }

  const body = buildMePayload({
    user: { id: user.id, email: user.email },
    profile: profileRow,
    assignments: assignmentRows,
    direct: (direct.data ?? []) as DirectPermissionRow[],
    bundles: (bundles.data ?? []) as RoleBundleRow[],
    now: new Date(),
  });
  return NextResponse.json(body, { headers: NO_STORE });
}
