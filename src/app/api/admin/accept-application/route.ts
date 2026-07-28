import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureStudentRole } from "@/lib/auth/membership-roles";
import { setupProgramBillingOnAcceptance } from "@/services/billing-generation";
import { Resend } from "resend";
import { applicationAcceptedEmailHtml } from "@/lib/email/templates/application-accepted";
import { enrollmentConfirmationEmailHtml } from "@/lib/email/templates/enrollment-confirmation";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";
import {
  substitutePlaceholders,
  plainTextToEmailHtml,
} from "@/lib/email/placeholders";

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
  const { response_id, admin_notes } = body;

  if (!response_id) {
    return NextResponse.json(
      { error: "response_id is required" },
      { status: 400 }
    );
  }

  const adminSupabase = createAdminClient();

  // Fetch the application response
  // The select includes columns added by migration 018 that may not be in auto-generated types yet
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
    programs: {
      id: string;
      name: string;
      code: string;
      acceptance_email_subject: string | null;
      acceptance_email_body: string | null;
    };
  };

  if (appResponse.status === "accepted") {
    return NextResponse.json(
      { error: "This application has already been accepted" },
      { status: 400 }
    );
  }

  const applicantInfo = appResponse.applicant_info as {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    date_of_birth?: string;
    gender?: string;
    nationality?: string;
    country?: string;
    city?: string;
  } | null;

  // Fall back to the linked user's email when the response row itself stores no
  // applicant_email / applicant_info.email (e.g. staff-created or imported
  // applications, where the address lives on the linked users row). Mirrors
  // getApplicantDetails() and the resend-invite route, which already do this.
  let linkedUserEmail: string | null = null;
  if (appResponse.user_id) {
    const { data: linkedUser } = await adminSupabase
      .from("users")
      .select("email")
      .eq("id", appResponse.user_id)
      .maybeSingle();
    linkedUserEmail =
      (linkedUser as { email?: string | null } | null)?.email ?? null;
  }

  const applicantEmail =
    appResponse.applicant_email ?? applicantInfo?.email ?? linkedUserEmail;

  if (!applicantEmail) {
    return NextResponse.json(
      { error: "No email found for this applicant" },
      { status: 400 }
    );
  }

  // Update response status to accepted
  await adminSupabase
    .from("application_responses")
    .update({
      status: "accepted",
      reviewed_by: authUser.id,
      reviewed_at: new Date().toISOString(),
      ...(admin_notes !== undefined ? { admin_notes } : {}),
    })
    .eq("id", response_id);

  let userId = appResponse.user_id;

  // If this is a public application (no user_id), create the user account
  if (!userId) {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const fromEmail =
      (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();

    // Check if a user with this email already exists
    const { data: existingUser } = await adminSupabase
      .from("users")
      .select("id, first_name")
      .eq("email", applicantEmail)
      .maybeSingle();

    if (existingUser) {
      userId = existingUser.id;

      // Link the response to the existing user
      await adminSupabase
        .from("application_responses")
        .update({ user_id: userId })
        .eq("id", response_id);

      // Send enrollment confirmation email (no invite link - user already has an account)
      const firstName =
        (existingUser as { first_name?: string | null }).first_name ||
        applicantInfo?.first_name ||
        "there";

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

      await resend.emails.send({
        from: `Fire & Fragrance SA <${fromEmail}>`,
        to: applicantEmail,
        subject: customSubject ?? `You're enrolled in ${appResponse.programs.name}`,
        html: enrollmentConfirmationEmailHtml({
          firstName,
          programName: appResponse.programs.name,
          siteUrl,
          customBodyHtml,
        }),
      });
    } else {
      // Create new user via Supabase Auth invite
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
      userId = linkData.user?.id;

      if (!userId) {
        return NextResponse.json(
          { error: "Failed to get user ID" },
          { status: 500 }
        );
      }

      // Create app-level user record with applicant info
      const { error: userError } = await adminSupabase.from("users").insert({
        id: userId,
        email: applicantEmail,
        first_name: applicantInfo?.first_name || null,
        last_name: applicantInfo?.last_name || null,
        phone: applicantInfo?.phone || null,
        date_of_birth: applicantInfo?.date_of_birth || null,
        gender: applicantInfo?.gender || null,
        nationality: applicantInfo?.nationality || null,
        country: applicantInfo?.country || null,
        city: applicantInfo?.city || null,
        invited_at: new Date().toISOString(),
        status: "active",
      });

      if (userError) {
        return NextResponse.json(
          { error: `Failed to create user record: ${userError.message}` },
          { status: 500 }
        );
      }

      // Link the response to the new user
      await adminSupabase
        .from("application_responses")
        .update({ user_id: userId })
        .eq("id", response_id);

      // Assign default self_service role
      const { data: selfServiceRole } = await adminSupabase
        .from("roles")
        .select("id")
        .eq("name", "self_service")
        .single();

      if (selfServiceRole) {
        await adminSupabase.from("user_roles").insert({
          user_id: userId,
          role_id: selfServiceRole.id,
          assigned_by: authUser.id,
        });
      }

      // Send acceptance email with invite link
      const newApplicantFirstName = applicantInfo?.first_name || "there";
      const placeholders = {
        first_name: newApplicantFirstName,
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

      await resend.emails.send({
        from: `Fire & Fragrance SA <${fromEmail}>`,
        to: applicantEmail,
        subject:
          customSubject ?? `You've been accepted to ${appResponse.programs.name}`,
        html: applicationAcceptedEmailHtml({
          firstName: newApplicantFirstName,
          programName: appResponse.programs.name,
          inviteUrl,
          customBodyHtml,
        }),
      });
    }
  }

  // Being accepted into a school makes the person a student (staff stays
  // staff, community_member becomes student). Covers pre-linked, existing,
  // and newly-created accounts.
  await ensureStudentRole(adminSupabase, userId, authUser.id);

  // Create enrollment
  const { data: enrollRow, error: enrollError } = await adminSupabase
    .from("enrollments")
    .insert({
      user_id: userId,
      program_id: appResponse.program_id,
      enrolled_by: authUser.id,
    })
    .select("id")
    .single();

  if (enrollError && !enrollError.message.includes("duplicate")) {
    return NextResponse.json(
      { error: `Failed to create enrollment: ${enrollError.message}` },
      { status: 500 }
    );
  }

  // Resolve the enrolment id (new, or existing if it was a duplicate).
  let enrollmentId: string | null = enrollRow?.id ?? null;
  if (!enrollmentId) {
    const { data: existing } = await adminSupabase
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("program_id", appResponse.program_id)
      .maybeSingle();
    enrollmentId = existing?.id ?? null;
  }

  // Auto-set up the full-program billing schedule and generate the deposit
  // invoice. Non-throwing — never blocks acceptance if billing isn't configured.
  if (enrollmentId) {
    const billing = await setupProgramBillingOnAcceptance(
      adminSupabase,
      enrollmentId,
      authUser.id
    );
    console.log("[accept-application] billing setup:", billing);
  }

  // Audit log
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "accept_application",
    resource_type: "application_responses",
    resource_id: response_id,
    changes: {
      applicant_email: applicantEmail,
      program_id: appResponse.program_id,
      new_user_id: userId,
    },
  });

  return NextResponse.json({ success: true, user_id: userId });
}
