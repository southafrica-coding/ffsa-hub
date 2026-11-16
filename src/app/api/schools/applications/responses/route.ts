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
  removeEnrollmentForApplicant,
  ensureEnrollmentForApplicant,
  setEnrollmentRemoved,
} from "@/services/schools";
import {
  programIdsForTargets,
  userCanDeleteApplication,
  userCanManageApplications,
  userCanManageEveryProgram,
  userCanManageProgram,
} from "@/lib/auth/check-schools-access";
import {
  userCanReadApplication,
  APPLICATIONS_EXPIRED_MESSAGE,
  getApplicationExpiry,
} from "@/lib/auth/application-expiry";
import { normaliseGender } from "@/lib/schools/demographics";
import { ensureStudentRole, deactivateMembershipProfile } from "@/lib/auth/membership-roles";
import { sendTransactional } from "@/lib/email/send-transactional";
import { resolveProgramEmail } from "@/lib/email/render-program-email";
import { sendReferenceInvite } from "@/lib/email/send-reference-invite";
import { sendReferenceReminder } from "@/lib/email/send-reference-reminder";
import { referenceSendConfirmed } from "@/lib/email/reference-email";
import { claimThenSendReferenceReminder, type ReminderAttempt } from "@/lib/references/reminder-claim";
import { previewWriteRefusal } from "@/lib/preview-writes";
import {
  BULK_STATUS_LIMIT,
  acceptedRegressNeedsConfirm,
  storedStatusError,
} from "@/lib/schools/application-status";
import { syncApplicantToContact } from "@/lib/applications/sync-contact";
import { sendAcceptanceToLinkedAccount } from "@/lib/schools/acceptance-email";
import { applicationRejectedEmailHtml } from "@/lib/email/templates/application-rejected";
import { applicationWaitlistedEmailHtml } from "@/lib/email/templates/application-waitlisted";
import { interviewScheduledEmailHtml } from "@/lib/email/templates/interview-scheduled";
import { selfRefereeError } from "@/lib/references/self-referee";


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
  // Track selection (migration 221) — which segment(s) of a split school
  // (e.g. FFX's Q1/Q2/Q3), or the whole programme. Absent for every ordinary
  // program, since the form only sends it when the school has segments.
  const trackChoice: { whole_program?: boolean; segment_ids?: unknown } | null =
    body.track_choice && typeof body.track_choice === "object" ? body.track_choice : null;

  if (!program_id || !answers || !Array.isArray(answers)) {
    return NextResponse.json(
      { error: "program_id and answers array are required" },
      { status: 400 }
    );
  }

  // Track selection (migration 221) — fetch this program's segments so we
  // can validate the submission and build a readable label. Every ordinary
  // program has none, so this is a no-op for them. The generated Supabase
  // types predate billing_courses (095/098), so this reads via an `any`
  // cast the same way the public apply route does.
  const segmentDb = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: segmentRows } = await segmentDb
    .from("billing_courses")
    .select("id, code, name")
    .eq("program_id", program_id)
    .in("status", ["active", "upcoming"]);
  const segmentById = new Map<string, { id: string; code: string; name: string }>();
  for (const s of (segmentRows ?? []) as Array<{ id: string; code: string; name: string }>) {
    segmentById.set(s.id, s);
  }
  // A school is split into segments only with two or more live courses
  // (matches getTrackSegments); a lone course is just the school itself.
  if (segmentById.size < 2) segmentById.clear();

  let trackSegmentIds: string[] = [];
  let trackIsWholeProgram = false;
  if (segmentById.size > 0) {
    if (!trackChoice) {
      return NextResponse.json(
        { error: "Please choose which part of the programme you're applying for." },
        { status: 400 }
      );
    }
    trackIsWholeProgram = trackChoice.whole_program === true;
    if (!trackIsWholeProgram) {
      const requested = Array.isArray(trackChoice.segment_ids) ? trackChoice.segment_ids : [];
      trackSegmentIds = requested.filter(
        (id: unknown): id is string => typeof id === "string" && segmentById.has(id)
      );
      if (trackSegmentIds.length === 0) {
        return NextResponse.json(
          { error: "Please choose at least one section, or the whole programme." },
          { status: 400 }
        );
      }
    }
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

  const { data: account, error: accountError } = await supabase
    .from("users")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json(
      { error: "Could not check the referee email." },
      { status: 500 }
    );
  }
  const selfReferee = selfRefereeError(
    submittedRefs,
    [user.email, account?.email],
    requiredSlotsCheck ?? []
  );
  if (selfReferee) {
    return NextResponse.json({ error: selfReferee }, { status: 400 });
  }

  // Persist nationality / home country the same way the public flow does, so
  // the fee-tier and demographics reads (applicant_info.nationality) work for
  // logged-in applicants too. Surface them in the answers list for reviewers.
  const applicantInfo: Record<string, unknown> = {};
  if (nationality) applicantInfo.nationality = nationality;
  if (homeCountry) applicantInfo.home_country = homeCountry;
  // Gender is asked as a normal program question; normalise it onto
  // applicant_info so the demographics dashboard reads it the same way it reads
  // nationality (see migration 148). Unrecognised answers are not stored.
  const genderAnswer = (answers as Array<{ question_label?: string; answer?: string }>).find(
    (a) => (a.question_label ?? "").toLowerCase().includes("gender") && a.answer?.trim()
  );
  const gender = normaliseGender(genderAnswer?.answer ?? null);
  if (gender) applicantInfo.gender = gender;
  const answersWithCountry = [
    ...(nationality
      ? [{ question_id: "nationality", question_label: "Nationality", answer: nationality }]
      : []),
    ...(homeCountry
      ? [{ question_id: "home_country", question_label: "Home Country", answer: homeCountry }]
      : []),
    ...answers,
  ];

  // Same treatment for the track choice, when this program has segments —
  // reviewers see it in the answers list for free, same as country.
  if (segmentById.size > 0) {
    const label = trackIsWholeProgram
      ? "Whole programme"
      : trackSegmentIds
          .map((id) => segmentById.get(id)?.name ?? segmentById.get(id)?.code)
          .filter(Boolean)
          .join(", ");
    answersWithCountry.push({
      question_id: "program_track",
      question_label: "Which part are you applying for?",
      answer: label,
    });
  }

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

  // Persist the track choice (migration 221) — best-effort, never blocks the
  // submission the applicant is waiting on. Only the service-role client can
  // write this table (RLS grants authenticated users read only).
  if (segmentById.size > 0) {
    const rows = trackIsWholeProgram
      ? [{ application_response_id: data.id, billing_course_id: null }]
      : trackSegmentIds.map((id) => ({
          application_response_id: data.id,
          billing_course_id: id,
        }));
    const { error: segmentInsertError } = await (createAdminClient() as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from("application_segment_choices")
      .insert(rows);
    if (segmentInsertError) {
      console.error("[applications] segment choice insert failed", segmentInsertError);
    }
  }

  // Add the applicant to the CRM contact base (email-deduped) and tag them
  // "FFSA Family". Fire-and-forget — never blocks or fails the submission. Uses
  // the admin client for the name read (bypasses users-table RLS) and the
  // contact upsert.
  void (async () => {
    const admin = createAdminClient();
    const { data: nameRow } = await admin
      .from("users")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();
    await syncApplicantToContact(admin, {
      email: user.email,
      firstName: nameRow?.first_name ?? null,
      lastName: nameRow?.last_name ?? null,
      nationality,
      homeCountry,
      userId: user.id,
      programId: program_id,
      applicationId: data.id,
    });
  })().catch((err) =>
    console.error("[applications] contact sync failed", err)
  );

  // Keep the applicant's profile nationality (and gender) in sync with what
  // they just declared on the application, so everything else in the Hub that
  // reads users.nationality / users.gender benefits (their profile was likely
  // blank before). Admin client so it isn't blocked by users-table update RLS;
  // scoped to their own row. Best-effort — never fail the submission on this.
  const profileSync: Record<string, string> = {};
  if (nationality) profileSync.nationality = nationality;
  if (gender) profileSync.gender = gender;
  if (Object.keys(profileSync).length > 0) {
    await createAdminClient()
      .from("users")
      .update(profileSync)
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

        const sent = await sendReferenceInvite({
          toEmail: ref.referee_email,
          refereeName: ref.referee_name,
          applicantName,
          programName: program?.name ?? "School Program",
          slotLabel: slot?.label ?? "Reference",
          token: refRequest.token,
          programId: program_id,
          referenceRequestId: refRequest.id,
        });

        if (referenceSendConfirmed(sent)) {
          await (adminSupabase as any)
            .from("reference_requests")
            .update({ email_sent_at: new Date().toISOString() })
            .eq("id", refRequest.id);
        }
      }
    }
  }

  // Hand back the tracker link (mirrors the public apply route) so the portal's
  // success screen can point the applicant at where their references show up.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const statusUrl = data.status_token
    ? `${siteUrl}/apply/status/${data.status_token}`
    : null;

  return NextResponse.json({ success: true, response: data, statusUrl });
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

// Shown when a status change would mark someone accepted without an account
// to enrol. The Accept action is what invites them.
const NO_ACCOUNT_ACCEPT_MESSAGE =
  "This applicant has no account yet, so they were not marked accepted. Use Accept to invite them, enrol them, and send the acceptance email.";

const ENROLL_FAILED_MESSAGE =
  "Could not enrol this applicant, so they were not marked accepted.";

const ENROLL_FAILED_SINGLE = "Could not enrol; status unchanged.";

type ApplicantForEnrollment = {
  id: string;
  status?: string;
  user_id?: string | null;
  program_id?: string | null;
  applicant_email?: string | null;
};

// Status, acceptance, and admin notes stay with people who manage the
// school. Program staff write application_staff_reviews instead, and
// userCanManageProgram is false for them.
async function denyUnlessCanDecide(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  responseIds: string[]
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("application_responses")
    .select("id, program_id")
    .in("id", responseIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  const programIds = [...new Set(data.map((row) => row.program_id as string))];
  for (const programId of programIds) {
    if (!(await userCanManageProgram(supabase, userId, programId))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }
  return null;
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
  const confirmRegress = body.confirm_regress === true;

  // ── Bulk status update ──
  if (ids && Array.isArray(ids) && ids.length > 0 && status) {
    const statusError = storedStatusError(status);
    if (statusError) return NextResponse.json({ error: statusError }, { status: 400 });
    if (ids.length > BULK_STATUS_LIMIT) {
      return NextResponse.json(
        { error: `You can update at most ${BULK_STATUS_LIMIT} applications at once.` },
        { status: 400 }
      );
    }
    const denied = await denyUnlessCanDecide(supabase, user.id, ids);
    if (denied) return denied;
    const adminSupabase = createAdminClient();
    const { data: existingRows, error: existingError } = await adminSupabase
      .from("application_responses")
      .select("id, status, user_id, program_id, applicant_email")
      .in("id", ids);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    const rows = (existingRows ?? []) as ApplicantForEnrollment[];
    if (
      rows.some((row) =>
        acceptedRegressNeedsConfirm(row.status, status, confirmRegress)
      )
    ) {
      return NextResponse.json(
        {
          error:
            "An accepted applicant is still enrolled. Confirm to move them back to an earlier stage.",
          code: "accepted_regress",
        },
        { status: 409 }
      );
    }
    const previousById = new Map(rows.map((row) => [row.id, row.status as string]));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    let updated = 0;
    // Rows left on their previous status. no_account needs Accept; enroll_failed
    // is a database error and must not be described as a missing account.
    const skipped: Array<{
      id: string;
      code: "no_account" | "enroll_failed";
      message: string;
    }> = [];
    const failures: Array<{ id: string; code: "status_failed"; message: string }> = [];
    // Acceptance emails that could not be delivered — returned so the admin
    // sees them instead of a clean success.
    const emailWarnings: string[] = [];

    for (const responseId of ids) {
      // Enrol before the status write. no_account writes nothing, so the row
      // stays where it was. An account is enrolled first, then marked accepted,
      // so a saved "accepted" always has an enrolment behind it.
      let enrollmentResult: Awaited<ReturnType<typeof ensureEnrollmentForApplicant>> | null =
        null;
      if (status === "accepted") {
        const row = rowById.get(responseId);
        enrollmentResult = await ensureEnrollmentForApplicant(
          adminSupabase,
          {
            id: responseId,
            user_id: row?.user_id ?? null,
            program_id: row?.program_id ?? "",
            applicant_email: row?.applicant_email ?? null,
          },
          user.id
        );
        if (enrollmentResult.outcome === "no_account") {
          skipped.push({
            id: responseId,
            code: "no_account",
            message: NO_ACCOUNT_ACCEPT_MESSAGE,
          });
          continue;
        }
        if (enrollmentResult.outcome === "enroll_failed") {
          skipped.push({
            id: responseId,
            code: "enroll_failed",
            message: ENROLL_FAILED_MESSAGE,
          });
          continue;
        }
      }

      const { data: resp, error } = await updateResponseStatus(
        supabase,
        responseId,
        status,
        user.id,
        admin_notes
      );
      if (error) {
        // The enrolment was written before this RLS update. If that write
        // created the row and the status did not stick, take it back off the
        // roster. Keep going so the rest of the batch still reports.
        if (
          status === "accepted" &&
          (enrollmentResult?.outcome === "created" || enrollmentResult?.outcome === "restored") &&
          enrollmentResult.enrollmentId
        ) {
          await setEnrollmentRemoved(adminSupabase, enrollmentResult.enrollmentId, user.id);
        }
        failures.push({
          id: responseId,
          code: "status_failed",
          message: error.message,
        });
        continue;
      }
      if (resp) {
        updated++;

        // Leaving a school (rejected/cancelled) deactivates a student-level
        // account. Guarded in the helper so staff/admin are never touched.
        // Accepting has to put them on the roster, or they are accepted and
        // invisible: the Arrival tab and every headcount read enrollments, not
        // application status. The dedicated Accept route already does this —
        // this path used to change the status and stop there. The enrolment
        // itself was created above, before this status write.
        if (status === "accepted") {
          if (send_email && previousById.get(responseId) !== "accepted") {
            // They have an account and are now enrolled — tell them. This
            // path used to send nothing on "accepted" (see sendStatusEmail).
            const sent = await sendAcceptanceToLinkedAccount(adminSupabase, responseId);
            if (sent.warning) emailWarnings.push(sent.warning);
          }
        }

        if ((status === "rejected" || status === "cancelled") && resp.user_id) {
          await deactivateMembershipProfile(adminSupabase, resp.user_id, `application_${status}`);
          // …and takes them off the roster. An accepted applicant already has
          // an enrollment row; left behind it keeps them in the student list
          // and in every dashboard headcount. Soft-remove, so Restore still
          // undoes it losslessly.
          await removeEnrollmentForApplicant(
            adminSupabase,
            resp.user_id,
            resp.program_id,
            user.id
          );
        }

        // Send notification email only when this row's status actually changed.
        if (send_email && previousById.get(responseId) !== status) {
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

    const partial = skipped.length > 0 || failures.length > 0;
    return NextResponse.json({
      success: true,
      updated,
      skipped,
      failures,
      partial,
      emailWarnings,
    });
  }

  // ── Single status update ──
  if (!id || !status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  const statusError = storedStatusError(status);
  if (statusError) return NextResponse.json({ error: statusError }, { status: 400 });

  const denied = await denyUnlessCanDecide(supabase, user.id, [id]);
  if (denied) return denied;

  // Get the current response to check previous status and whether we can enrol.
  const adminSupabase = createAdminClient();
  const { data: prevResponse, error: prevError } = await adminSupabase
    .from("application_responses")
    .select("id, status, user_id, program_id, applicant_email")
    .eq("id", id)
    .single();
  if (prevError) return NextResponse.json({ error: prevError.message }, { status: 500 });

  const previousStatus = prevResponse?.status;
  if (acceptedRegressNeedsConfirm(previousStatus, status, confirmRegress)) {
    return NextResponse.json(
      {
        error:
          "This applicant is already accepted and still enrolled. Confirm to move them back to an earlier stage.",
        code: "accepted_regress",
      },
      { status: 409 }
    );
  }

  // Same rule as the bulk path: do not save accepted unless an enrolment exists.
  // no_account is side-effect free, so this refusal leaves the previous status.
  // enroll_failed is a database error and must not be saved as accepted either.
  let enrollmentResult: Awaited<ReturnType<typeof ensureEnrollmentForApplicant>> | null =
    null;
  if (status === "accepted") {
    const current = prevResponse as ApplicantForEnrollment | null;
    enrollmentResult = await ensureEnrollmentForApplicant(
      adminSupabase,
      {
        id,
        user_id: current?.user_id ?? null,
        program_id: current?.program_id ?? "",
        applicant_email: current?.applicant_email ?? null,
      },
      user.id
    );
    if (enrollmentResult.outcome === "no_account") {
      return NextResponse.json(
        { error: NO_ACCOUNT_ACCEPT_MESSAGE, code: "no_account" },
        { status: 409 }
      );
    }
    if (enrollmentResult.outcome === "enroll_failed") {
      return NextResponse.json({ error: ENROLL_FAILED_SINGLE }, { status: 500 });
    }
  }

  const { data, error } = await updateResponseStatus(supabase, id, status, user.id, admin_notes);

  if (error) {
    if (
      status === "accepted" &&
      (enrollmentResult?.outcome === "created" || enrollmentResult?.outcome === "restored") &&
      enrollmentResult.enrollmentId
    ) {
      await setEnrollmentRemoved(adminSupabase, enrollmentResult.enrollmentId, user.id);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The enrolment was created above, before this status write.
  let emailWarning: string | null = null;
  if (status === "accepted" && data && send_email && previousStatus !== "accepted") {
    const sent = await sendAcceptanceToLinkedAccount(adminSupabase, id);
    emailWarning = sent.warning;
  }

  // Leaving a school (rejected/cancelled) deactivates a student-level account.
  // Guarded in the helper so staff/admin accounts are never touched.
  if ((status === "rejected" || status === "cancelled") && data?.user_id) {
    await deactivateMembershipProfile(adminSupabase, data.user_id, `application_${status}`);
    // …and takes them off the roster — see the bulk path above.
    await removeEnrollmentForApplicant(
      adminSupabase,
      data.user_id,
      data.program_id,
      user.id
    );
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

  return NextResponse.json({
    success: true,
    response: data,
    ...(emailWarning ? { emailWarning } : {}),
  });
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
    switch (status) {
      case "rejected":
        emailType = "application_rejected";
        defaultSubject = `Application Update — ${programName}`;
        defaultHtml = applicationRejectedEmailHtml({ firstName, programName });
        break;
      case "waitlisted":
        emailType = "application_waitlisted";
        defaultSubject = `Application Update — ${programName}`;
        defaultHtml = applicationWaitlistedEmailHtml({ firstName, programName });
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
        break;
      // "accepted" is sent by sendAcceptanceToLinkedAccount (PUT) or the
      // accept-application route — never from here.
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
          values: { first_name: firstName, program_name: programName },
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
      programDocuments: { programId, emailType },
    });
  } catch {
    // Don't fail the status update if email fails
    console.error(`Failed to send status email to ${toEmail}`);
  }
}

// ── PATCH: Reference reminder ──
const REFERENCE_REMINDER_SELECT =
  "id, status, reminder_sent_at, referee_email, referee_name, token, application_id, reference_slots(label), application_responses(id, program_id, applicant_info, applicant_email, user_id, users!application_responses_user_id_fkey(first_name, last_name), programs(name))";

type ReminderApplication = {
  id?: string;
  program_id?: string | null;
  applicant_info?: { first_name?: string | null; last_name?: string | null } | null;
  users?: { first_name?: string | null; last_name?: string | null } | null;
  programs?: { name?: string | null } | null;
};

type ReminderRequestRow = {
  id: string;
  status: string;
  reminder_sent_at?: string | null;
  referee_email: string;
  referee_name: string;
  token: string;
  reference_slots?: { label?: string | null } | null;
  application_responses?: ReminderApplication | null;
};

function reminderApplicantName(app: ReminderApplication | null | undefined): string {
  const fromUser = app?.users
    ? [app.users.first_name, app.users.last_name].filter(Boolean).join(" ")
    : "";
  const fromInfo = [app?.applicant_info?.first_name, app?.applicant_info?.last_name]
    .filter(Boolean)
    .join(" ");
  return fromUser || fromInfo || "An applicant";
}

function reminderAttemptResponse(attempt: ReminderAttempt) {
  if (attempt.outcome === "sent") {
    return NextResponse.json({
      success: true,
      emailed: true,
      skipped: false,
      reminder_sent_at: attempt.reminderSentAt,
    });
  }
  if (attempt.outcome === "disabled") {
    return NextResponse.json({ success: true, emailed: false, skipped: true });
  }
  if (attempt.outcome === "not_outstanding") {
    return NextResponse.json(
      { error: "This reference has already been submitted." },
      { status: 409 }
    );
  }
  if (attempt.outcome === "cooldown") {
    return NextResponse.json(
      {
        error: attempt.error,
        retry_after_seconds: attempt.retryAfterSeconds,
        next_allowed_at: attempt.nextAllowedAt,
      },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } }
    );
  }
  return NextResponse.json(
    { error: "error" in attempt ? attempt.error : "Could not send the reminder." },
    { status: 500 }
  );
}

function previewRefusalResponse() {
  const refusal = previewWriteRefusal();
  if (!refusal) return null;
  return NextResponse.json(refusal.body, { status: refusal.status });
}

async function authorizeReferenceReminder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  applicationId: string | null | undefined,
  programId: string | null | undefined
) {
  if (!applicationId || !(await userCanReadApplication(supabase, applicationId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!programId || !(await userCanManageProgram(supabase, userId, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return null;
}

function sendReminderForRow(ref: ReminderRequestRow) {
  const app = ref.application_responses;
  return sendReferenceReminder({
    toEmail: ref.referee_email,
    refereeName: ref.referee_name,
    applicantName: reminderApplicantName(app),
    programName: app?.programs?.name ?? "School Program",
    slotLabel: ref.reference_slots?.label ?? "Reference",
    token: ref.token,
    programId: app?.program_id ?? null,
    referenceRequestId: ref.id,
  });
}

/**
 * Claim reminder_sent_at, then send the existing reminder email.
 * The daily cron uses the same helper.
 */
async function deliverReferenceReminder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  ref: ReminderRequestRow
) {
  return claimThenSendReferenceReminder({
    admin,
    refId: ref.id,
    status: ref.status,
    previousSentAt: ref.reminder_sent_at ?? null,
    send: () => sendReminderForRow(ref),
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { action, reference_request_id, id, application_id } = body;

  // ── Archive / restore an application (reversible "remove") ──
  if (action === "archive" || action === "restore") {
    const ids = applicationTargetIds(body);
    if (!id || !ids) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    // Every id in the batch has to pass userCanManageProgram. ids is check-only.
    const denied = await denyUnlessApplicationPrograms(supabase, user.id, ids);
    if (denied) return denied;
    // RLS-backed: the 6-month expiry lock (migration 223) applies here too.
    if (!(await userCanReadApplication(supabase, id))) {
      return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
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

    const { data: refReq } = await (adminSupabase as any)
      .from("reference_requests")
      .select(REFERENCE_REMINDER_SELECT)
      .eq("id", reference_request_id)
      .single();

    if (!refReq) {
      return NextResponse.json({ error: "Reference request not found" }, { status: 404 });
    }

    const app = refReq.application_responses as ReminderApplication | null;
    const denied = await authorizeReferenceReminder(
      supabase,
      user.id,
      app?.id,
      app?.program_id
    );
    if (denied) return denied;

    const preview = previewRefusalResponse();
    if (preview) return preview;

    const result = await deliverReferenceReminder(adminSupabase, refReq as ReminderRequestRow);
    return reminderAttemptResponse(result);
  }

  if (action === "send_outstanding_reference_reminders" && application_id) {
    const adminSupabase = createAdminClient();
    const { data: app } = await (adminSupabase as any)
      .from("application_responses")
      .select(
        "id, program_id, applicant_info, applicant_email, user_id, users!application_responses_user_id_fkey(first_name, last_name), programs(name)"
      )
      .eq("id", application_id)
      .single();

    if (!app?.id) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const denied = await authorizeReferenceReminder(
      supabase,
      user.id,
      app.id,
      app.program_id
    );
    if (denied) return denied;

    // Stop before any claim. Preview shares the live database.
    const preview = previewRefusalResponse();
    if (preview) return preview;

    const { data: refs, error: refsError } = await (adminSupabase as any)
      .from("reference_requests")
      .select(REFERENCE_REMINDER_SELECT)
      .eq("application_id", application_id);

    if (refsError) {
      return NextResponse.json({ error: refsError.message }, { status: 500 });
    }

    const results: Array<{
      id: string;
      outcome: ReminderAttempt["outcome"];
      error?: string;
      retry_after_seconds?: number;
      next_allowed_at?: string;
    }> = [];

    for (const ref of (refs ?? []) as ReminderRequestRow[]) {
      const row: ReminderRequestRow = {
        ...ref,
        application_responses: app as ReminderApplication,
      };
      try {
        const attempt = await deliverReferenceReminder(adminSupabase, row);
        results.push({
          id: ref.id,
          outcome: attempt.outcome,
          error: "error" in attempt ? attempt.error : undefined,
          retry_after_seconds:
            attempt.outcome === "cooldown" ? attempt.retryAfterSeconds : undefined,
          next_allowed_at: attempt.outcome === "cooldown" ? attempt.nextAllowedAt : undefined,
        });
      } catch (err) {
        results.push({
          id: ref.id,
          outcome: "error",
          error: err instanceof Error ? err.message : "Could not send the reminder.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      emailed: results.filter((row) => row.outcome === "sent").length,
      results,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

async function expiredWithoutAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  programId: string
): Promise<boolean> {
  try {
    const expiry = await getApplicationExpiry(supabase, programId);
    if (expiry.lookupFailed) return false;
    return expiry.expired && !expiry.canAccess;
  } catch {
    return false;
  }
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

  const body = await request.json().catch(() => ({}));
  const { id } = body;
  const ids = applicationTargetIds(body);
  if (!id || !ids) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  // userCanManageProgram for every target. userCanDeleteApplication stays on
  // top of that, in the block below, so an expired school still gets its
  // own message. A program_leaders row or schools.manage_enrollments can
  // manage the school and still be refused the delete.
  const denied = await denyUnlessApplicationPrograms(supabase, user.id, ids);
  if (denied) return denied;

  const adminSupabase = createAdminClient();

  const { data: existing, error: fetchError } = await adminSupabase
    .from("application_responses")
    .select("id, status, program_id, applicant_email, user_id")
    .eq("id", id)
    .single();

  // Both gates are required. userCanDeleteApplication is migration 223's
  // DELETE policy (a program_leaders row is not enough). The user-client
  // read is RLS, and it is what keeps a school-scoped grant inside that
  // school — the service role below would otherwise ignore it. A missing
  // row has no program, so the policy check stays global.
  const allowed = existing?.program_id
    ? await userCanDeleteApplication(supabase, user.id, existing.program_id)
    : await userCanManageApplications(supabase, user.id);
  if (!allowed) {
    if (existing?.program_id && (await expiredWithoutAccess(supabase, existing.program_id))) {
      return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fail closed: a throw, an error, or no row is not permission to delete.
  let canRead = false;
  try {
    canRead = (await userCanReadApplication(supabase, id)) === true;
  } catch {
    canRead = false;
  }
  if (!canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

/**
 * `id` is the row the handler writes. `ids`, when the body sends it, is
 * check-only: every id has to be a real application in a program this user
 * manages, and a bad entry rejects the request. Nothing in `ids` is written.
 */
function applicationTargetIds(body: { id?: unknown; ids?: unknown }): string[] | null {
  const ids: string[] = [];
  if (typeof body.id === "string" && body.id.length > 0) ids.push(body.id);
  if (Array.isArray(body.ids)) {
    for (const id of body.ids) {
      if (typeof id !== "string" || id.length === 0) return null;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids.length > 0 ? ids : null;
}

async function denyUnlessApplicationPrograms(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ids: string[]
) {
  const programs = await programIdsForTargets(createAdminClient(), "application_responses", ids);
  if (!programs || !(await userCanManageEveryProgram(supabase, userId, programs))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
