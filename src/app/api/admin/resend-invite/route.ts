import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { applicationAcceptedEmailHtml } from "@/lib/email/templates/application-accepted";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

export async function POST(request: Request) {
  // Verify the calling user has schools-management access
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const hasAccess = await userCanManageApplications(supabase, authUser.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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
    .select("*, programs(id, name, code)")
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
    programs: { id: string; name: string; code: string };
  };

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

  const isActive =
    !!authData.user.email_confirmed_at || !!authData.user.last_sign_in_at;

  if (isActive) {
    // User has already confirmed their account - don't send a new invite
    return NextResponse.json({ alreadyActive: true });
  }

  // Generate a fresh invite link
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const { data: linkData, error: linkError } =
    await adminSupabase.auth.admin.generateLink({
      type: "invite",
      email: applicantEmail,
      options: {
        redirectTo: `${siteUrl}/auth/confirm`,
      },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      {
        error:
          linkError?.message || "Failed to generate invite link",
      },
      { status: 500 }
    );
  }

  const inviteUrl = linkData.properties.action_link;

  // Send the acceptance email with the new invite URL
  const fromEmail =
    (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();

  const firstName =
    appUser.first_name || applicantInfo?.first_name || "there";

  const { error: sendError } = await resend.emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: applicantEmail,
    subject: `You've been accepted to ${appResponse.programs.name}`,
    html: applicationAcceptedEmailHtml({
      firstName,
      programName: appResponse.programs.name,
      inviteUrl,
    }),
  });

  if (sendError) {
    return NextResponse.json(
      { error: `Failed to send invite email: ${sendError.message}` },
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
