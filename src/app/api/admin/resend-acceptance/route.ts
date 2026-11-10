import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { sendAcceptanceToLinkedAccount } from "@/lib/schools/acceptance-email";

// Re-send the acceptance email itself — no setup link. For when the first one
// went to Junk or was deleted. (Resend Invite mints a setup link and refuses
// anyone who already has a password, so it can't do this.)
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const responseId: string | undefined = body?.response_id;
  if (!responseId) {
    return NextResponse.json({ error: "response_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: resp } = await admin
    .from("application_responses")
    .select("id, status, program_id")
    .eq("id", responseId)
    .maybeSingle();
  if (!resp) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!(await userCanManageProgram(supabase, authUser.id, resp.program_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (resp.status !== "accepted") {
    return NextResponse.json(
      { error: "Only accepted applications can be sent an acceptance email" },
      { status: 400 }
    );
  }

  const sent = await sendAcceptanceToLinkedAccount(admin, responseId);
  if (!sent.sent) {
    return NextResponse.json(
      { error: sent.warning ?? "Failed to resend the acceptance email" },
      { status: 500 }
    );
  }

  await admin.from("audit_logs").insert({
    user_id: authUser.id,
    action: "resend_acceptance",
    resource_type: "application_responses",
    resource_id: responseId,
    changes: { applicant_email: sent.email },
  });

  return NextResponse.json({ success: true, email: sent.email });
}
