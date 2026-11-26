import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureStudentRole } from "@/lib/auth/membership-roles";
import { createOnboardingInvite } from "@/lib/auth/onboarding-invite";
import {
  resolveSetupInviteDueDate,
  formatInviteDate,
} from "@/lib/schools/setup-invite-schedule";
import { setupProgramBillingOnAcceptance } from "@/services/billing-generation";
import { sendTransactional } from "@/lib/email/send-transactional";
import { applicationAcceptedEmailHtml } from "@/lib/email/templates/application-accepted";
import { sendAcceptanceToLinkedAccount } from "@/lib/schools/acceptance-email";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { userCanReadApplication, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";
import {
  substitutePlaceholders,
  plainTextToEmailHtml,
} from "@/lib/email/placeholders";
import { applicantEmailIlikePattern } from "@/lib/applications/applicant-identity";
import { copyApplicationAssigneeToEnrollment } from "@/lib/schools/staff-assignment-sync";

type EnrollmentLookup = {
  from: (table: string) => {
    select: (columns: string) => {
      ilike: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => PromiseLike<{
          data: { id?: string } | null;
          error: { message: string } | null;
        }>;
      };
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          maybeSingle: () => PromiseLike<{
            data: { id?: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

// An application already marked accepted can still be finished when no
// enrolment exists (the status dropdown used to save "accepted" and stop).
// An enrolment row — including a soft-removed one — means Accept must stop,
// or a second click would enrol, bill, and email again.
async function acceptedApplicantAlreadyEnrolled(
  admin: EnrollmentLookup,
  app: {
    user_id: string | null;
    program_id: string;
    applicant_email: string | null;
  }
): Promise<"yes" | "no" | "error"> {
  let userId = app.user_id;
  if (!userId) {
    const email = app.applicant_email;
    if (!email) return "no";
    let pattern: string;
    try {
      pattern = applicantEmailIlikePattern(email);
    } catch {
      return "no";
    }
    const { data: account, error } = await admin
      .from("users")
      .select("id")
      .ilike("email", pattern)
      .maybeSingle();
    if (error) return "error";
    if (!account?.id) return "no";
    userId = account.id as string;
  }

  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id")
    .eq("user_id", userId)
    .eq("program_id", app.program_id)
    .maybeSingle();
  if (enrollmentError) return "error";
  return enrollment?.id ? "yes" : "no";
}


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

  // Authorize against THIS application's program: global schools managers, or
  // a user scoped specifically to this program. Deferred until here because we
  // need the program id from the fetched response.
  if (
    !(await userCanManageProgram(supabase, authUser.id, appResponse.programs.id))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // RLS-backed: the 6-month expiry lock (migration 223).
  if (!(await userCanReadApplication(supabase, response_id))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  if (appResponse.status === "accepted") {
    const infoEmail =
      appResponse.applicant_info &&
      typeof appResponse.applicant_info === "object" &&
      "email" in appResponse.applicant_info &&
      typeof appResponse.applicant_info.email === "string"
        ? appResponse.applicant_info.email
        : null;
    const alreadyEnrolled = await acceptedApplicantAlreadyEnrolled(adminSupabase, {
      user_id: appResponse.user_id,
      program_id: appResponse.program_id,
      applicant_email: appResponse.applicant_email ?? infoEmail,
    });
    if (alreadyEnrolled === "error") {
      return NextResponse.json(
        { error: "Could not check whether this applicant is already enrolled." },
        { status: 500 }
      );
    }
    if (alreadyEnrolled === "yes") {
      return NextResponse.json(
        {
          error: "This application has already been accepted",
          code: "already_enrolled",
        },
        { status: 400 }
      );
    }
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

  // Remember where we started: if creating the account fails below, the
  // application goes back to this status so the admin can retry. Leaving it
  // "accepted" made Accept refuse ("already accepted") and stranded the
  // applicant with no account, no enrolment and no email.
  const previousStatus = appResponse.status;
  const revertStatus = () =>
    adminSupabase
      .from("application_responses")
      .update({ status: previousStatus })
      .eq("id", response_id);
  // Applied while signed in (or linked earlier): the account already exists,
  // so none of the account-creation branches below run — the acceptance email
  // is sent after enrolment instead.
  const wasPreLinked = !!appResponse.user_id;

  // Same rule as the public duplicate check: ILIKE is case-insensitive, `_`
  // and `%` are escaped, and `*` is refused. PostgREST treats `*` as a
  // wildcard a backslash cannot escape, so matching on it could attach this
  // application to the wrong account.
  let applicantEmailPattern: string;
  try {
    applicantEmailPattern = applicantEmailIlikePattern(applicantEmail);
  } catch {
    return NextResponse.json(
      { error: "This applicant's email can't be matched safely." },
      { status: 400 }
    );
  }

  // Compare-and-set claim. Two Accepts can both see "no enrolment" and both
  // pass the check above; only the update that still matches the status we
  // read is allowed to create an account, send mail, enrol, or bill.
  //
  // A finish of an already-accepted row also holds a 5-minute lease on
  // reviewed_at. Matching only the value this request read is not enough: the
  // second request can load the reviewed_at the first one just wrote, before
  // that first request inserts the enrolment, and then its claim matches.
  // The lease refuses a recent reviewed_at before any write, and the update
  // itself only matches when reviewed_at is still null or older than the lease.
  const ACCEPT_LEASE_MS = 5 * 60 * 1000;
  const reviewedAt = (appResponse as { reviewed_at?: string | null }).reviewed_at ?? null;
  const nowMs = Date.now();
  const leaseCutoff = new Date(nowMs - ACCEPT_LEASE_MS).toISOString();
  if (previousStatus === "accepted" && reviewedAt) {
    const reviewedMs = Date.parse(reviewedAt);
    if (!Number.isNaN(reviewedMs) && reviewedMs > nowMs - ACCEPT_LEASE_MS) {
      return NextResponse.json(
        {
          error:
            "This application was accepted moments ago. If it didn't finish, try again in a few minutes.",
        },
        { status: 409 }
      );
    }
  }
  const claimedAt = new Date().toISOString();
  const claimBase = adminSupabase
    .from("application_responses")
    .update({
      status: "accepted",
      reviewed_by: authUser.id,
      reviewed_at: claimedAt,
    })
    .eq("id", response_id)
    .eq("status", previousStatus);
  const claim =
    previousStatus === "accepted"
      ? (reviewedAt == null
          ? claimBase.is("reviewed_at", null)
          : claimBase.eq("reviewed_at", reviewedAt)
        ).or(`reviewed_at.is.null,reviewed_at.lt.${leaseCutoff}`)
      : claimBase;
  const { data: claimed, error: claimError } = await claim.select("id");
  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "This application is already being accepted. Refresh and check." },
      { status: 409 }
    );
  }

  if (admin_notes !== undefined) {
    // Table is newer than the generated Database types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: notesError } = await (adminSupabase as any).from("application_admin_notes").upsert(
      {
        application_response_id: response_id,
        program_id: appResponse.programs.id,
        notes: admin_notes,
        updated_by: authUser.id,
      },
      { onConflict: "application_response_id" }
    );
    if (notesError) {
      await revertStatus();
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }
  }

  let userId = appResponse.user_id;

  // Set when the acceptance email could not be delivered, so the caller is
  // told rather than shown a clean success.
  let emailWarning: string | null = null;

  // If this is a public application (no user_id), create the user account
  if (!userId) {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    // Check if a user with this email already exists. Case-insensitive: auth
    // stores addresses lowercased, so an applicant who typed "Name@Gmail.com"
    // with an existing account would miss an exact match, then fail in
    // createUser ("already registered") after the status was set.
    const { data: existingUser } = await adminSupabase
      .from("users")
      .select("id, first_name")
      .ilike("email", applicantEmailPattern)
      .maybeSingle();

    if (existingUser) {
      userId = existingUser.id;

      // Link the response to the existing user
      await adminSupabase
        .from("application_responses")
        .update({ user_id: userId })
        .eq("id", response_id);

      // Send enrollment confirmation email (no invite link - user already
      // has an account). A failed send used to be ignored here.
      const sent = await sendAcceptanceToLinkedAccount(adminSupabase, response_id, {
        siteUrl,
      });
      emailWarning = sent.warning;
    } else {
      // Create the auth user directly (no password yet). The applicant sets
      // their password via the 30-day onboarding setup link emailed below —
      // an app-controlled token (migration 158) that replaces Supabase's
      // short-lived, one-time magic-link invite. email_confirm: true because
      // reaching this point means an admin accepted the application and we're
      // emailing the address; the same trust the /join signup flow relies on.
      const { data: created, error: createError } =
        await adminSupabase.auth.admin.createUser({
          email: applicantEmail,
          email_confirm: true,
          user_metadata: {
            first_name: applicantInfo?.first_name || null,
            last_name: applicantInfo?.last_name || null,
          },
        });

      if (createError || !created?.user?.id) {
        await revertStatus();
        return NextResponse.json(
          { error: createError?.message || "Failed to create user account" },
          { status: 500 }
        );
      }

      userId = created.user.id;

      // Hold the setup link back until a month before the school starts (or
      // the school's own date) — migration 230. null = send it now.
      const setupInviteDueOn = await resolveSetupInviteDueDate(
        adminSupabase,
        appResponse.program_id
      );

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
        invited_at: setupInviteDueOn ? null : new Date().toISOString(),
        setup_invite_due_on: setupInviteDueOn,
        status: "active",
      });

      if (userError) {
        await revertStatus();
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

      // Household match (migration 181): if a Hub member already entered this
      // person as their spouse using this email, flag the household as a
      // PENDING match. Nothing is shared until they confirm it on their first
      // sign-in — then they inherit the family and skip the spouse/children
      // questions. Only on this branch: an account that already existed is
      // past its creation window and is never auto-linked.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (adminSupabase as any).rpc("link_household_on_signup", {
          p_user_id: userId,
        });
      } catch {
        // Non-fatal — they simply get their own household.
      }

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

      // Mint the 30-day, single-use onboarding setup link (migration 158) —
      // unless it's scheduled for later, in which case the cron
      // send-setup-invites mints and sends it on the due date.
      let inviteUrl: string | null = null;
      if (!setupInviteDueOn) {
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

        inviteUrl = invite.url;
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

      const acceptSend = await sendTransactional({
        to: applicantEmail,
        subject:
          customSubject ?? `You've been accepted to ${appResponse.programs.name}`,
        html: applicationAcceptedEmailHtml({
          firstName: newApplicantFirstName,
          programName: appResponse.programs.name,
          inviteUrl,
          setupInviteOn: setupInviteDueOn
            ? formatInviteDate(setupInviteDueOn)
            : null,
          customBodyHtml,
        }),
        category: "application_accepted",
        sourceType: "school_application",
        sourceId: response_id,
        // When the setup link rides in this email, so do its documents.
        programDocuments: {
          programId: appResponse.program_id,
          emailType: inviteUrl
            ? ["application_accepted", "account_setup_link"]
            : "application_accepted",
        },
      });

      // The setup token exists either way, but if the email never went out
      // the applicant has no way to know that. Returning a bare success here
      // is how people ended up accepted, account created, and locked out with
      // nobody aware. Surface it so the admin can act.
      if (!acceptSend.ok) {
        emailWarning = acceptSend.suppressed
          ? `${applicantEmail} is on the email suppression list (previous bounce or spam complaint), so the acceptance email was not sent. They can still get in via "Forgot password" on the login page.`
          : `The acceptance email to ${applicantEmail} failed to send: ${acceptSend.error}. Use Resend Invite, or ask them to use "Forgot password" on the login page.`;
      }
    }
  }

  // Being accepted into a school makes the person a student (staff stays
  // staff, community_member becomes student). Covers pre-linked, existing,
  // and newly-created accounts.
  await ensureStudentRole(adminSupabase, userId, authUser.id);

  // Create enrollment. insertedThisRequest is false when the unique pair
  // already existed, so billing must not rebuild a schedule that is there.
  const { data: enrollRow, error: enrollError } = await adminSupabase
    .from("enrollments")
    .insert({
      user_id: userId,
      program_id: appResponse.program_id,
      enrolled_by: authUser.id,
    })
    .select("id")
    .single();
  const insertedThisRequest = Boolean(enrollRow?.id);

  if (enrollError && !enrollError.message.includes("duplicate")) {
    return NextResponse.json(
      { error: `Failed to create enrollment: ${enrollError.message}` },
      { status: 500 }
    );
  }

  // Resolve the enrolment id (new, or existing if it was a duplicate).
  let enrollmentId: string | null = enrollRow?.id ?? null;
  let restoredThisRequest = false;
  if (!enrollmentId) {
    const { data: existing } = await adminSupabase
      .from("enrollments")
      .select("id, removed_at")
      .eq("user_id", userId)
      .eq("program_id", appResponse.program_id)
      .maybeSingle();
    enrollmentId = existing?.id ?? null;
    // (user_id, program_id) is unique, so a re-accepted applicant reuses the
    // enrollment they already had. If it was soft-removed — cancelled, then
    // accepted again — accepting must put them back on the roster, otherwise
    // they stay invisible everywhere.
    if (enrollmentId && existing?.removed_at) {
      await adminSupabase
        .from("enrollments")
        .update({ removed_at: null, removed_by: null })
        .eq("id", enrollmentId);
      restoredThisRequest = true;
    }
  }

  // Assigned on the application becomes Walking with on the enrolment this
  // request created or restored. No assignment email: that went out when
  // Assigned was set. A failed copy never blocks acceptance.
  if (enrollmentId && (insertedThisRequest || restoredThisRequest)) {
    const assignment = appResponse as unknown as {
      assigned_staff_id?: string | null;
      staff_assigned_at?: string | null;
      staff_assigned_by?: string | null;
    };
    await copyApplicationAssigneeToEnrollment(adminSupabase, {
      enrollmentId,
      programId: appResponse.program_id,
      application: {
        assigned_staff_id: assignment.assigned_staff_id ?? null,
        staff_assigned_at: assignment.staff_assigned_at ?? null,
        staff_assigned_by: assignment.staff_assigned_by ?? null,
      },
      actorId: authUser.id,
    });
  }

  // Carry the applicant's chosen track (migration 221) onto the new
  // enrolment before billing runs, so setupProgramBillingOnAcceptance bills
  // the segment(s) they actually applied for instead of always defaulting
  // to whole-program. No rows here (a program with no segments configured,
  // or an application that predates this feature) falls back to that
  // historical default, unchanged.
  if (enrollmentId) {
    // The generated Supabase types predate these tables (migration 221),
    // same as the billing_courses reads elsewhere in this module.
    const segmentDb = adminSupabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: choices } = await segmentDb
      .from("application_segment_choices")
      .select("billing_course_id")
      .eq("application_response_id", response_id);
    if (choices && choices.length > 0) {
      await segmentDb
        .from("enrollment_segments")
        .delete()
        .eq("enrollment_id", enrollmentId);
      await segmentDb.from("enrollment_segments").insert(
        choices.map((c: { billing_course_id: string | null }) => ({
          enrollment_id: enrollmentId,
          billing_course_id: c.billing_course_id,
          created_by: authUser.id,
        }))
      );
    }
  }

  // Auto-set up the full-program billing schedule and generate the deposit
  // invoice. Non-throwing — never blocks acceptance if billing isn't configured.
  // replaceScheduledRows rewrites the whole schedule, so a second call can
  // send a second deposit. Bill only for the row this request inserted, or
  // when that enrolment has no plan yet.
  let billingAlreadyExists = false;
  if (enrollmentId && !insertedThisRequest) {
    // student_billing_plans predates the generated Database types, same as
    // the segment tables above.
    const planDb = adminSupabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: plan, error: planError } = await planDb
      .from("student_billing_plans")
      .select("id")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (planError || plan?.id) billingAlreadyExists = true;
  }
  if (enrollmentId && !billingAlreadyExists) {
    const billing = await setupProgramBillingOnAcceptance(
      adminSupabase,
      enrollmentId,
      authUser.id
    );
    console.log("[accept-application] billing setup:", billing);
  }

  // Pre-linked applicants (applied while signed in) never went through either
  // email branch above, so they were accepted and enrolled in silence.
  if (wasPreLinked) {
    const sent = await sendAcceptanceToLinkedAccount(adminSupabase, response_id);
    emailWarning = sent.warning;
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
      email_warning: emailWarning,
    },
  });

  return NextResponse.json({
    success: true,
    user_id: userId,
    ...(emailWarning ? { emailWarning } : {}),
  });
}
