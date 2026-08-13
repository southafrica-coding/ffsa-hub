import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationAcceptedEmailHtml } from "@/lib/email/templates/application-accepted";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { sendTransactional } from "@/lib/email/send-transactional";
import { createOnboardingInvite } from "@/lib/auth/onboarding-invite";
import {
  substitutePlaceholders,
  plainTextToEmailHtml,
} from "@/lib/email/placeholders";

export async function POST(request: Request) {
  // Verify the calling user has schools-management access
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { response_id } = body;

  if (!response_id) {
    return NextResponse.json(
      { error: "response_id is required" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  // Fetch the application response with program info
  const { data: rawResponse, error: fetchError } = await adminSupabase
    .from("application_responses")
    .select(
      "*, programs(id, name, code, acceptance_email_subject, acceptance_email_body)"
    )
    .eq("id", response_id)
    .single();

  if (fetchError || !rawResponse) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  const appResponse = rawResponse as typeof rawResponse & {
    applicant_email: string | null;
    applicant_info: Record<string, string> | null;
    user_id: string | null;
    programs: {
      id: string;
      name: string;
      code: string;
      acceptance_email_subject: string | null;
      acceptance_email_body: string | null;
    };
  };

  // Authorize against THIS application's program: global schools managers, or
  // a user scoped specifically to this program.
  if (
    !(await userCanManageProgram(supabase, authUser.id, appResponse.programs.id))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const applicantInfo = appResponse.applicant_info as {
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;

  const userId = appResponse.user_id;

  if (!userId) {
    return NextResponse.json(
      { error: "No user associated with this application" },
      { status: 400 }
    );
  }

  // Look up the user record
  const { data: appUser, error: userError } = await adminSupabase
    .from("users")
    .select("id, email, first_name, accepted_at")
    .eq("id", userId)
    .single();

  if (userError || !appUser) {
    return NextResponse.json(
      { error: "User record not found" },
      { status: 404 }
    );
  }

  const applicantEmail =
    appUser.email ?? appResponse.applicant_email ?? applicantInfo?.email;

  if (!applicantEmail) {
    return NextResponse.json(
      { error: "No email found for this applicant" },
      { status: 400 }
    );
  }

  // Skip if the user has already finished onboarding (set their password).
  // Accepted applicants are created with email_confirm: true, so email
  // confirmation is no longer a signal of activation — accepted_at is.
  if (appUser.accepted_at) {
    return NextResponse.json({ alreadyActive: true });
  }

  // Mint a fresh 30-day, single-use onboarding setup link (migration 158),
  // superseding any previously emailed link. Replaces the old Supabase
  // magic-link invite, which expired in <=24h and was burned by email
  // scanners before the applicant could click it.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const invite = await createOnboardingInvite(adminSupabase, {
    userId,
    email: applicantEmail,
    siteUrl,
    createdBy: authUser.id,
  });

  if (!invite.ok) {
    return NextResponse.json(
      { error: `Failed to create onboarding link: ${invite.error}` },
      { status: 500 }
    );
  }

  const inviteUrl = invite.url;

  // Send the acceptance email with the new invite URL. Honor the same
  // per-program subject/body overrides the accept route uses, so a
  // re-sent invite matches the customized acceptance email instead of
  // silently reverting to the hardcoded default.
  const firstName =
    appUser.first_name || applicantInfo?.first_name || "there";

  const placeholders = {
    first_name: firstName,
    program_name: appResponse.programs.name,
  };
  const customSubject = appResponse.programs.acceptance_email_subject
    ? substitutePlaceholders(
        appResponse.programs.acceptance_email_subject,
        placeholders
      )
    : null;
  const customBodyHtml = appResponse.programs.acceptance_email_body
    ? plainTextToEmailHtml(
        substitutePlaceholders(
          appResponse.programs.acceptance_email_body,
          placeholders
        )
      )
    : null;

  const sendResult = await sendTransactional({
    to: applicantEmail,
    subject:
      customSubject ?? `You've been accepted to ${appResponse.programs.name}`,
    html: applicationAcceptedEmailHtml({
      firstName,
      programName: appResponse.programs.name,
      inviteUrl,
      customBodyHtml,
    }),
    category: "application_accepted",
    sourceType: "school_application",
    sourceId: response_id,
  });

  if (!sendResult.ok) {
    return NextResponse.json(
      { error: `Failed to send invite email: ${sendResult.error}` },
      { status: 500 }
    );
  }

  // Audit log
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "resend_invite",
    resource_type: "application_responses",
    resource_id: response_id,
    changes: {
      applicant_email: applicantEmail,
      user_id: userId,
    },
  });

  return NextResponse.json({ success: true });
}
