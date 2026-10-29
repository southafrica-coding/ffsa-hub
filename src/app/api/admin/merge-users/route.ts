// FFSA Hub — POST /api/admin/merge-users
//
// Body: { winnerId, loserId, mode: "preview" | "dryRun" | "merge" }
//
// Three modes on purpose. "preview" is the cheap count for rendering the
// screen; "dryRun" performs the whole merge and rolls it back, which is what
// actually proves it will work; "merge" commits.
//
// super_admin or admin (General Admin) — same as delete-user, and likewise
// only a super admin may merge a super admin's account.
// A merge touches billing, consent, roles and enrolments across every
// subsystem at once and there is no unmerge.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseSuperAdminTarget } from "@/lib/auth/super-admin-target";
import {
  previewUserMerge,
  dryRunMerge,
  mergeUsers,
  retireLoserAuthUser,
} from "@/services/user-merge";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!adminCheck || adminCheck.length === 0) {
    return NextResponse.json(
      { error: "Only an admin can merge accounts" },
      { status: 403 }
    );
  }

  let body: { winnerId?: string; loserId?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { winnerId, loserId } = body;
  const mode = body.mode ?? "preview";

  if (!winnerId || !loserId) {
    return NextResponse.json(
      { error: "winnerId and loserId are required" },
      { status: 400 }
    );
  }
  if (winnerId === loserId) {
    return NextResponse.json(
      { error: "Pick two different accounts" },
      { status: 400 }
    );
  }
  // The SQL function refuses this too; caught here for a clearer message.
  if (loserId === authUser.id) {
    return NextResponse.json(
      { error: "You cannot merge away your own account" },
      { status: 400 }
    );
  }
  if (!["preview", "dryRun", "merge"].includes(mode)) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }

  const admin = createAdminClient();

  // A merge retires the losing account and rewrites the winning one, so a
  // super admin on either side makes it a super admin's call. Refused in
  // preview too, so the UI says so before anyone reviews a merge.
  const refused = await refuseSuperAdminTarget(
    supabase,
    authUser.id,
    admin,
    [winnerId, loserId]
  );
  if (refused) return refused;

  if (mode === "preview") {
    const { preview, error } = await previewUserMerge(admin, winnerId, loserId);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ preview });
  }

  if (mode === "dryRun") {
    const { report, error } = await dryRunMerge(
      admin,
      winnerId,
      loserId,
      authUser.id
    );
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ report, wouldSucceed: true });
  }

  // mode === "merge". Re-run the dry run first: it is cheap relative to the
  // cost of a half-understood merge, and it means the UI cannot commit
  // something that was never validated.
  const check = await dryRunMerge(admin, winnerId, loserId, authUser.id);
  if (check.error) {
    return NextResponse.json(
      { error: `Merge aborted before making changes: ${check.error}` },
      { status: 400 }
    );
  }

  const { report, error } = await mergeUsers(
    admin,
    winnerId,
    loserId,
    authUser.id
  );
  if (error) return NextResponse.json({ error }, { status: 400 });

  const { warning } = await retireLoserAuthUser(admin, loserId, winnerId);

  return NextResponse.json({ report, warning });
}
