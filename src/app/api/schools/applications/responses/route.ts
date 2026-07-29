import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createResponse,
  updateResponseStatus,
  getReferenceSlotsByProgram,
  getQuestionsByProgram,
  createReferenceRequest,
  setResponseRemoved,
} from "@/services/schools";
import { userCanManageApplications } from "@/lib/auth/check-schools-access";
import { ensureStudentRole, deactivateMembershipProfile } from "@/lib/auth/membership-roles";
import { sendTransactional } from "@/lib/email/send-transactional";
import { resolveProgramEmail } from "@/lib/email/render-program-email";
import { sendReferenceInvite } from "@/lib/email/send-reference-invite";
import { referenceReminderEmailHtml } from "@/lib/email/templates/reference-reminder";
import { applicationRejectedEmailHtml } from "@/lib/email/templates/application-rejected";
import { applicationWaitlistedEmailHtml } from "@/lib/email/templates/application-waitlisted";
import { interviewScheduledEmailHtml } from "@/lib/email/templates/interview-scheduled";


export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id, answers, references } = body;
  const nationality =
    typeof body.nationality === "string" ? body.nationality.trim() : "";
  const homeCountry =
    typeof body.home_country === "string" ? body.home_country.trim() : "";

  if (!program_id || !answers || !Array.isArray(answers)) {
    return NextResponse.json(
      { error: "program_id and answers array are required" },
      { status: 400 }
    );
  }

  // Required-field validation, authoritative regardless of what the client did.
  // A required field is required whether or not the applicant is logged in.
  const { data: questions } = await getQuestionsByProgram(supabase, program_id);
  const questionList = (questions ?? []) as Array<{
    id: string;
    is_required: boolean;
    system_key?: string | null;
  }>;
  const hasNationalityQ = questionList.some((q) => q.system_key === "nationality");
  const hasHomeCountryQ = questionList.some((q) => q.system_key === "home_country");
  if (hasNationalityQ && !nationality) {
    return NextResponse.json({ error: "Nationality is required." }, { status: 400 });
  }
  if (hasHomeCountryQ && !homeCountry) {
    return NextResponse.json({ error: "Home country is required." }, { status: 400 });
  }
  // Required non-system answers (system country fields are validated above and
  // travel outside the answers array).
  const requiredIds = new Set(
    questionList
      .filter((q) => q.is_required && !q.system_key)
      .map((q) => q.id)
  );
  for (const a of answers as Array<{
    question_id: string;
    question_label: string;
    answer: string;
  }>) {
    if (requiredIds.has(a.question_id) && !a.answer?.trim()) {
      return NextResponse.json(
        { error: `Please answer the required question: "${a.question_label}"` },
        { status: 400 }
      );
    }
  }

  // Enforce required references server-side (the client form validates too).
  const { data: requiredSlotsCheck } = await getReferenceSlotsByProgram(
    supabase,
    program_id
  );
  const submittedRefs: Array<{
    slot_id?: string;
    referee_name?: string;
    referee_email?: string;
  }> = Array.isArray(references) ? references : [];
  for (const slot of requiredSlotsCheck ?? []) {
    if (!slot.is_required) continue;
    const provided = submittedRefs.find(
      (ref) =>
        ref.slot_id === slot.id &&
        ref.referee_name?.trim() &&
        ref.referee_email?.trim()
    );
    if (!provided) {
      return NextResponse.json(
        { error: `Please provide referee details for the required reference: "${slot.label}"` },
        { status: 400 }
      );
    }
  }

  // Persist nationality / home country the same way the public flow does, so
  // the fee-tier and demographics reads (applicant_info.nationality) work for
  // logged-in applicants too. Surface them in the answers list for reviewers.
  const applicantInfo: Record<string, unknown> = {};
  if (nationality) applicantInfo.nationality = nationality;
  if (homeCountry) applicantInfo.home_country = homeCountry;
  const answersWithCountry = [
    ...(nationality
      ? [{ question_id: "nationality", question_label: "Nationality", answer: nationality }]
      : []),
    ...(homeCountry
      ? [{ question_id: "home_country", question_label: "Home Country", answer: homeCountry }]
      : []),
    ...answers,
  ];

  const { data, error } = await createResponse(supabase, {
    program_id,
    user_id: user.id,
    answers: answersWithCountry,
    // Always stamp the applicant's email onto the row itself, so downstream
    // flows (acceptance, resend-invite, export) never depend on the linked
    // users join being readable. Signed-in applicants otherwise left this null.
    applicant_email: user.email ?? null,
    applicant_info: Object.keys(applicantInfo).length > 0 ? applicantInfo : null,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You have already submitted an application for this program" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Keep the applicant's profile nationality in sync with what they just
  // declared on the application, so everything else in the Hub that reads
  // users.nationality benefits (their profile was likely blank before). Admin
  // client so it isn't blocked by users-table update RLS; scoped to their own
  // row. Best-effort — never fail the submission on this.
  if (nationality) {
    await createAdminClient()
      .from("users")
      .update({ nationality })
      .eq("id", user.id);
  }

  // Applying for a school makes the applicant a student (staff stays staff;
  // community_member becomes student). Uses the admin client to write the role.
  await ensureStudentRole(createAdminClient(), user.id, user.id);

  // Create reference requests and send emails
  if (references && Array.isArray(references) && references.length > 0) {
    const adminSupabase = createAdminClient();

    const { data: slots } = await getReferenceSlotsByProgram(supabase, program_id);
    const slotMap = new Map<string, any>((slots ?? []).map((s: any) => [s.id, s]));

    const { data: appUser } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", user.id)
      .single();

    const { data: program } = await supabase
      .from("programs")
      .select("name")
      .eq("id", program_id)
      .single();

    const applicantName = appUser
      ? `${appUser.first_name ?? ""} ${appUser.last_name ?? ""}`.trim()
      : "the applicant";

    for (const ref of references) {
      if (!ref.slot_id || !ref.referee_name || !ref.referee_email) continue;

      const { data: refRequest } = await createReferenceRequest(adminSupabase, {
        application_id: data.id,
        slot_id: ref.slot_id,
        referee_name: ref.referee_name,
        referee_email: ref.referee_email,
      });

      if (refRequest) {
        const slot = slotMap.get(ref.slot_id);

        await sendReferenceInvite({
          toEmail: ref.referee_email,
          refereeName: ref.referee_name,
          applicantName,
          programName: program?.name ?? "School Program",
          slotLabel: slot?.label ?? "Reference",
          token: refRequest.token,
          programId: program_id,
        });

        await (adminSupabase as any)
          .from("reference_requests")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", refRequest.id);
      }
    }
  }

  return NextResponse.json({ success: true, response: data });
}

// Helper: get applicant email and name from a response
function getApplicantDetails(response: any) {
  const email =
    response.users?.email ??
    response.applicant_email ??
    response.applicant_info?.email ??
    null;
  const firstName =
    response.users?.first_name ??
    response.applicant_info?.first_name ??
    null;
  return { email, firstName: firstName || "there" };
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ids, status, admin_notes, send_email = true } = body;

  // ── Bulk status update ──
  if (ids && Array.isArray(ids) && ids.length > 0 && status) {
    const adminSupabase = createAdminClient();
    let updated = 0;

    for (const responseId of ids) {
      const { data: resp, error } = await updateResponseStatus(
        supabase,
        responseId,
        status,
        user.id,
        admin_notes
      );
      if (!error && resp) {
        updated++;

        // Leaving a school (rejected/cancelled) deactivates a student-level
        // account. Guarded in the helper so staff/admin are never touched.
        if ((status === "rejected" || status === "cancelled") && resp.user_id) {
          await deactivateMembershipProfile(adminSupabase, resp.user_id, `application_${status}`);
        }

        // Send notification email for bulk updates too
        if (send_email) {
          const { data: fullResp } = await adminSupabase
            .from("application_responses")
            .select("*, users!application_responses_user_id_fkey(first_name, email), programs(name)")
            .eq("id", responseId)
            .single();

          if (fullResp) {
            const { email, firstName } = getApplicantDetails(fullResp);
            const programName = fullResp.programs?.name ?? "School Program";
            if (email) {
              await sendStatusEmail(email, firstName, programName, status, admin_notes, responseId, fullResp.program_id);
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true, updated });
  }

  // ── Single status update ──
  if (!id || !status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  // Get the current response to check previous status
  const adminSupabase = createAdminClient();
  const { data: prevResponse } = await adminSupabase
    .from("application_responses")
    .select("status")
    .eq("id", id)
    .single();

  const previousStatus = prevResponse?.status;

  const { data, error } = await updateResponseStatus(supabase, id, status, user.id, admin_notes);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Leaving a school (rejected/cancelled) deactivates a student-level account.
  // Guarded in the helper so staff/admin accounts are never touched.
  if ((status === "rejected" || status === "cancelled") && data?.user_id) {
    await deactivateMembershipProfile(adminSupabase, data.user_id, `application_${status}`);
  }

  // Send notification email if status actually changed
  if (send_email && status !== previousStatus && status !== "submitted") {
    const { data: fullResp } = await adminSupabase
      .from("application_responses")
      .select("*, users!application_responses_user_id_fkey(first_name, email), programs(name)")
      .eq("id", id)
      .single();

    if (fullResp) {
      const { email, firstName } = getApplicantDetails(fullResp);
      const programName = fullResp.programs?.name ?? "School Program";
      if (email) {
        await sendStatusEmail(
          email,
          firstName,
          programName,
          status,
          admin_notes,
          id,
          fullResp.program_id
        );
      }
    }
  }

  return NextResponse.json({ success: true, response: data });
}

async function sendStatusEmail(
  toEmail: string,
  firstName: string,
  programName: string,
  status: string,
  notes?: string | null,
  responseId?: string | null,
  programId?: string | null
) {
  try {
    // Map the status to its email type + built-in default copy.
    let emailType: string;
    let defaultSubject: string;
    let defaultHtml: string;
    let heading: string;
    switch (status) {
      case "rejected":
        emailType = "application_rejected";
        defaultSubject = `Application Update — ${programName}`;
        defaultHtml = applicationRejectedEmailHtml({ firstName, programName });
        heading = "Application update";
        break;
      case "waitlisted":
        emailType = "application_waitlisted";
        defaultSubject = `Application Update — ${programName}`;
        defaultHtml = applicationWaitlistedEmailHtml({ firstName, programName });
        heading = "Application update";
        break;
      case "interview_scheduled":
        emailType = "interview_scheduled";
        defaultSubject = `Interview Scheduled — ${programName}`;
        defaultHtml = interviewScheduledEmailHtml({
          firstName,
          programName,
          interviewDate: undefined,
          interviewNotes: notes || undefined,
        });
        heading = "Interview scheduled";
        break;
      // "accepted" is handled by accept-application route
      // "references_received" and "submitted" don't need emails
      default:
        return;
    }

    // Apply the school's per-program override (on/off + subject + body).
    let subject = defaultSubject;
    let html = defaultHtml;
    if (programId) {
      const resolved = await resolveProgramEmail(
        createAdminClient(),
        programId,
        emailType,
        { subject: defaultSubject, html: defaultHtml },
        {
          firstName,
          programName,
          heading,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
        }
      );
      if (resolved.skip) return; // leader switched this email off
      subject = resolved.subject;
      html = resolved.html;
    }

    await sendTransactional({
      to: toEmail,
      sourceType: "school_application",
      sourceId: responseId ?? null,
      subject,
      html,
      category: emailType,
    });
  } catch {
    // Don't fail the status update if email fails
    console.error(`Failed to send status email to ${toEmail}`);
  }
}

// ── PATCH: Reference reminder ──
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { action, reference_request_id, id } = body;

  // ── Archive / restore an application (reversible "remove") ──
  if (action === "archive" || action === "restore") {
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!(await userCanManageApplications(supabase, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Gate is the permission check above; write with the admin client so the
    // broader set of application managers isn't blocked by the narrower
    // row-update RLS policy.
    const adminSupabase = createAdminClient();
    const { data, error } = await setResponseRemoved(
      adminSupabase,
      id,
      action === "archive",
      user.id
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await adminSupabase.from("audit_logs").insert({
      user_id: user.id,
      action: action === "archive" ? "archive_application" : "restore_application",
      resource_type: "application_responses",
      resource_id: id,
    });

    return NextResponse.json({ success: true, response: data });
  }

  if (action === "send_reference_reminder" && reference_request_id) {
    const adminSupabase = createAdminClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";

    const { data: refReq } = await (adminSupabase as any)
      .from("reference_requests")
      .select("*, reference_slots(label), application_responses(id, applicant_info, applicant_email, user_id, program_id, users!application_responses_user_id_fkey(first_name, last_name), programs(name))")
      .eq("id", reference_request_id)
      .single();

    if (!refReq || refReq.status === "submitted") {
      return NextResponse.json(
        { error: refReq ? "Reference already submitted" : "Reference request not found" },
        { status: 400 }
      );
    }

    const app = refReq.application_responses;
    const applicantName = app?.users
      ? [app.users.first_name, app.users.last_name].filter(Boolean).join(" ")
      : [app?.applicant_info?.first_name, app?.applicant_info?.last_name].filter(Boolean).join(" ") || "An applicant";

    const referenceUrl = `${siteUrl}/reference/${refReq.token}`;
    const reminderProgramName = app?.programs?.name ?? "School Program";
    const reminderDefaults = {
      subject: `Reference Reminder — ${reminderProgramName}`,
      html: referenceReminderEmailHtml({
        refereeName: refReq.referee_name,
        applicantName,
        programName: reminderProgramName,
        slotLabel: refReq.reference_slots?.label ?? "Reference",
        referenceUrl,
      }),
    };

    // Apply the school's per-program override; a custom body still gets the
    // "complete the reference" button re-appended so the link is never lost.
    let reminderSubject = reminderDefaults.subject;
    let reminderHtml = reminderDefaults.html;
    if (app?.program_id) {
      const resolved = await resolveProgramEmail(
        adminSupabase,
        app.program_id,
        "reference_reminder",
        reminderDefaults,
        {
          programName: reminderProgramName,
          heading: "A reference is waiting",
          cta: { label: "Complete the reference", url: referenceUrl },
          siteUrl,
        }
      );
      if (resolved.skip) {
        return NextResponse.json({ success: true, skipped: true });
      }
      reminderSubject = resolved.subject;
      reminderHtml = resolved.html;
    }

    await sendTransactional({
      to: refReq.referee_email,
      subject: reminderSubject,
      html: reminderHtml,
      category: "reference_reminder",
      sourceType: "school_application",
      sourceId: app?.id ?? null,
    });

    // Update reminder_sent_at
    await (adminSupabase as any)
      .from("reference_requests")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", reference_request_id);

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ── DELETE: permanently remove an application ──
// Guarded: accepted applications own an enrollment / billing / user account,
// so they can never be hard-deleted here — they must be archived instead.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!(await userCanManageApplications(supabase, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: existing, error: fetchError } = await adminSupabase
    .from("application_responses")
    .select("id, status, program_id, applicant_email, user_id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (existing.status === "accepted") {
    return NextResponse.json(
      {
        error:
          "This application has been accepted and has an enrolment, billing, and possibly a user account attached. Archive it instead of deleting.",
      },
      { status: 409 }
    );
  }

  // reference_requests cascade via ON DELETE CASCADE.
  const { error: deleteError } = await adminSupabase
    .from("application_responses")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: user.id,
    action: "delete_application",
    resource_type: "application_responses",
    resource_id: id,
    changes: {
      status: existing.status,
      program_id: existing.program_id,
      applicant_email: existing.applicant_email,
    },
  });

  return NextResponse.json({ success: true });
}
