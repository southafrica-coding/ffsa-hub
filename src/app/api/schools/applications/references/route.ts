import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReferenceRequestsByApplication } from "@/services/schools";
import { SCHOOLS_MANAGE_PERMS, canManageSchools } from "@/lib/api-auth";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import {
  editReferenceContact,
  REFERENCE_EDIT_SELECT,
} from "@/lib/references/edit-reference-contact";
import { userCanReadApplication, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";
import { annotateReferenceDelivery } from "@/lib/references/reference-delivery";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("application_id");

  if (!applicationId) {
    return NextResponse.json(
      { error: "application_id is required" },
      { status: 400 }
    );
  }

  if (!(await userCanReadApplication(supabase, applicationId))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  const { data, error } = await getReferenceRequestsByApplication(
    supabase,
    applicationId
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const references = await annotateReferenceDelivery(
    createAdminClient(),
    applicationId,
    (data ?? []) as Array<{
      id: string;
      application_id?: string | null;
      referee_email: string;
      status: string;
      email_sent_at?: string | null;
    }>
  );

  return NextResponse.json({ references });
}

// PATCH — swap out a pending reference's contact (name/email). A changed
// email regenerates the invite token (old link dies) and re-sends the invite.
// The gate is this reference's school: a program-scoped leader can edit their
// own school, and a missing or unreadable program is a refusal.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const reference_request_id = body?.reference_request_id;
  if (!reference_request_id) {
    return NextResponse.json(
      { error: "reference_request_id is required" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();
  const programId = await programIdForReference(adminSupabase, reference_request_id);
  if (!programId) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [byProgram, byGrant] = await Promise.all([
    userCanManageProgram(supabase, user.id, programId),
    canManageSchools(supabase, user.id, SCHOOLS_MANAGE_PERMS, { programId }),
  ]);
  if (!byProgram && !byGrant) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: ref } = await adminSupabase
    .from("reference_requests")
    .select(REFERENCE_EDIT_SELECT)
    .eq("id", reference_request_id)
    .single();

  if (!ref) {
    return NextResponse.json(
      { error: "Reference request not found" },
      { status: 404 }
    );
  }

  if (!(await userCanReadApplication(supabase, ref.application_id))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  const result = await editReferenceContact(adminSupabase, ref, {
    referee_name: body?.referee_name,
    referee_email: body?.referee_email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    reference: result.data,
    emailed: result.emailed,
    email_changed: result.emailChanged,
  });
}

/** The school this reference belongs to. Null on any error or a missing row. */
async function programIdForReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  referenceId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("reference_requests")
    .select("application_id, application_responses(program_id)")
    .eq("id", referenceId)
    .maybeSingle();
  if (error || !data) return null;
  const application = data.application_responses;
  const row = Array.isArray(application) ? application[0] : application;
  const programId = row?.program_id;
  return typeof programId === "string" && programId.length > 0 ? programId : null;
}
