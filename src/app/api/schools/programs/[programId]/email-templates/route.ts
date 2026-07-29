import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { isProgramEmailType } from "@/lib/email/program-email-types";
import {
  listProgramEmailTemplates,
  upsertProgramEmailTemplate,
} from "@/services/program-email-templates";

// GET  /api/schools/programs/[programId]/email-templates  → list overrides
// PUT  /api/schools/programs/[programId]/email-templates  { emailType, enabled, subject, body }
//
// Managing a school's per-email overrides. Gated on program-scoped access
// (admins, global schools managers, and this program's leaders).

async function authorize(programId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await userCanManageProgram(supabase, user.id, programId))) {
    return { error: "Not authorized", status: 403 as const };
  }
  return { user };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = createAdminClient();
  const { data } = await listProgramEmailTemplates(admin, programId);
  return NextResponse.json({ templates: data ?? [] });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => ({}))) as {
    emailType?: string;
    enabled?: boolean;
    subject?: string | null;
    body?: string | null;
    reminderAfterDays?: number | null;
  };

  if (!body.emailType || !isProgramEmailType(body.emailType)) {
    return NextResponse.json(
      { error: "Unknown email type" },
      { status: 400 }
    );
  }

  // Auto-reminder days: clamp to the DB's 1..90 window, or null for off.
  let reminderAfterDays: number | null = null;
  if (body.reminderAfterDays != null && body.reminderAfterDays !== 0) {
    const n = Math.round(Number(body.reminderAfterDays));
    if (!Number.isFinite(n) || n < 1 || n > 90) {
      return NextResponse.json(
        { error: "Reminder days must be between 1 and 90" },
        { status: 400 }
      );
    }
    reminderAfterDays = n;
  }

  const admin = createAdminClient();
  // Empty strings collapse to null so "no override" is unambiguous and
  // the resolver falls back to the built-in default.
  const trimmedSubject = body.subject?.trim() ? body.subject.trim() : null;
  const trimmedBody = body.body?.trim() ? body.body : null;

  const { error } = await upsertProgramEmailTemplate(admin, {
    programId,
    emailType: body.emailType,
    enabled: body.enabled ?? true,
    subject: trimmedSubject,
    body: trimmedBody,
    reminderAfterDays,
    updatedBy: auth.user.id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = await listProgramEmailTemplates(admin, programId);
  return NextResponse.json({ templates: data ?? [] });
}
