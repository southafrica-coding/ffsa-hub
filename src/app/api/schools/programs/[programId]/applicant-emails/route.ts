import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { passesApplicationExpiry, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";

// GET /api/schools/programs/[programId]/applicant-emails?applicationId=...
//
// Delivery history for one application — every email the Hub sent tied to
// it (email_messages, migration 141, logged with source_type
// 'school_application'). Powers the "Email history" panel in the applicant
// review dialog. Gated on program-scoped access (leaders included).

export async function GET(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const applicationId = new URL(request.url).searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json(
      { error: "applicationId is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await userCanManageProgram(supabase, user.id, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (!(await passesApplicationExpiry(supabase, programId))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  // email_messages isn't in the generated DB types; the ledger treats it
  // as untyped everywhere, so do the same here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const columns =
    "id, category, subject, to_email, status, error, sent_at, delivered_at, opened_at, bounced_at, complained_at, created_at";

  const [{ data: appEmails, error }, { data: refRows }] = await Promise.all([
    admin
      .from("email_messages")
      .select(columns)
      .eq("source_type", "school_application")
      .eq("source_id", applicationId)
      .order("created_at", { ascending: false }),
    admin.from("reference_requests").select("id").eq("application_id", applicationId),
  ]);

  if (error) {
    // email_messages missing (pre-migration) → empty, never break the UI.
    return NextResponse.json({ emails: [] });
  }

  const refIds = ((refRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  let refEmails: Array<{ id: string; created_at: string }> = [];
  if (refIds.length > 0) {
    const { data } = await admin
      .from("email_messages")
      .select(columns)
      .eq("source_type", "reference_request")
      .in("source_id", refIds);
    refEmails = data ?? [];
  }

  const emails = [...(appEmails ?? []), ...refEmails].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  return NextResponse.json({ emails });
}
