import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseSuperAdminTarget } from "@/lib/auth/super-admin-target";
import { activateApprovedUser } from "@/services/users";
import { readSelfActor } from "@/lib/users/self-edit-guard";
import { permissionDeniedResponse } from "@/lib/users/users-update-error";

// users.job_title is unbounded text (migration 014). There is no column
// limit and no other app cap, so approval rejects anything longer than this.
const JOB_TITLE_MAX = 120;

function parseJobTitle(
  value: unknown
): { ok: true; jobTitle: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, jobTitle: undefined };
  if (value === null) return { ok: true, jobTitle: null };
  if (typeof value !== "string") {
    return { ok: false, error: "Job title must be text." };
  }
  const trimmed = value.trim();
  if (trimmed.length > JOB_TITLE_MAX) {
    return {
      ok: false,
      error: `Job title must be ${JOB_TITLE_MAX} characters or fewer.`,
    };
  }
  return { ok: true, jobTitle: trimmed === "" ? null : trimmed };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // The caller's own row. Inactive, missing, or unreadable is 403 before
  // any service-role write. This is the deactivated message, not a role miss.
  const actor = await readSelfActor(supabase, authUser.id);
  if (!actor.ok) return actor.response;

  // is_admin() is has_any_role(['super_admin','admin']) with scope_type IS NULL.
  // A scoped admin does not pass. A throw or an error fails closed.
  let unscopedAdmin = false;
  try {
    const { data, error } = await supabase.rpc("is_admin");
    if (!error && data === true) unscopedAdmin = true;
  } catch {
    unscopedAdmin = false;
  }
  if (!unscopedAdmin) return permissionDeniedResponse();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }
  const { user_id, job_title } = body as { user_id?: unknown; job_title?: unknown };

  if (!user_id || typeof user_id !== "string") {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const title = parseJobTitle(job_title);
  if (!title.ok) {
    return NextResponse.json({ error: title.error }, { status: 400 });
  }

  const admin = createAdminClient();

  // This also sets the job title, which on a super admin is theirs to change.
  const refused = await refuseSuperAdminTarget(supabase, authUser.id, admin, user_id);
  if (refused) return refused;

  // status and job_title go out in one service-role UPDATE. Two statements
  // could approve the account and then fail the title, returning an error
  // for a user who is already active. One statement applies both or neither.
  const { data, error } = await activateApprovedUser(admin, user_id, title.jobTitle);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "This user is not pending approval." },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, user: data });
}
