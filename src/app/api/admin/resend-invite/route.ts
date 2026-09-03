import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationAcceptedEmailHtml } from "@/lib/email/templates/application-accepted";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { sendSetupLink } from "@/lib/auth/send-setup-link";
import { userHasPassword } from "@/lib/auth/account-state";
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
    .select("id, email, first_name")
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

  // Check if the user has already activated their auth account
  const { data: authData, error: authLookupError } =
    await adminSupabase.auth.admin.getUserById(userId);

  if (authLookupError || !authData?.user) {
    return NextResponse.json(
      { error: "Auth user not found" },
      { status: 404 }
    );
  }

  // "Already activated" means they can SIGN IN, i.e. they have a password —
  // not that their email is confirmed. accept-application creates the auth
  // user with email_confirm: true and no password, so the old
  // email_confirmed_at check matched every accepted applicant and refused to
  // resend to exactly the people who needed it (migration 199).
  const hasPassword = await userHasPassword(adminSupabase, userId);

  if (hasPassword) {
    return NextResponse.json({ alreadyActive: true });
  }

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

  // Mint a fresh 30-day /setup token and email it. The old path generated a
  // Supabase magic-link invite, which migration 158 replaced precisely
  // because it expires in 24h and is burned by email scanners.
  const sendResult = await sendSetupLink(adminSupabase, {
    userId,
    email: applicantEmail,
    firstName,
    createdBy: authUser.id,
    subject:
      customSubject ?? `You've been accepted to ${appResponse.programs.name}`,
    html: (setupUrl) =>
      applicationAcceptedEmailHtml({
        firstName,
        programName: appResponse.programs.name,
        inviteUrl: setupUrl,
        customBodyHtml,
      }),
    category: "application_accepted",
    sourceType: "school_application",
    sourceId: response_id,
    reason: `An admin resent the acceptance email for ${appResponse.programs.name}.`,
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
