import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getProgramPublicInfo,
  getQuestionsByProgram,
  getResponseByEmailAndProgram,
  createPublicResponse,
  getReferenceSlotsByProgram,
  createReferenceRequest,
} from "@/services/schools";
import {
  getCurrentConsentAgreement,
  recordConsent,
} from "@/services/consent";
import { notifyApplicationSubmitted } from "@/lib/slack/notify";
import { syncApplicantToContact } from "@/lib/applications/sync-contact";
import { normaliseGender } from "@/lib/schools/demographics";
import { sendTransactional } from "@/lib/email/send-transactional";
import { resolveProgramEmail } from "@/lib/email/render-program-email";
import {
  applicationConfirmationEmailHtml,
  applicationReferenceNotice,
} from "@/lib/email/templates/application-confirmation";
import { sendReferenceInvite } from "@/lib/email/send-reference-invite";
import { referenceSendConfirmed } from "@/lib/email/reference-email";
import {
  applicantEmailIlikePattern,
  findAnswerByLabel,
  identityGaps,
  resolveApplicantIdentity,
  withIdentityAnswers,
} from "@/lib/applications/applicant-identity";
import { selfRefereeError } from "@/lib/references/self-referee";

export async function POST(request: Request) {
  const body = await request.json();
  const { program_id, answers, references, files, consent_version } = body;
  const homeCountry =
    typeof body.home_country === "string" ? body.home_country.trim() : "";
  const nationality =
    typeof body.nationality === "string" ? body.nationality.trim() : "";
  // Track selection (migration 221) — which segment(s) of a split school
  // (e.g. FFX's Q1/Q2/Q3), or the whole programme. Absent for every ordinary
  // program, since the form only sends it when the school has segments.
  const trackChoice: { whole_program?: boolean; segment_ids?: unknown } | null =
    body.track_choice && typeof body.track_choice === "object" ? body.track_choice : null;

  if (!program_id || !Array.isArray(answers)) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (!nationality) {
    return NextResponse.json(
      { error: "Nationality is required." },
      { status: 400 }
    );
  }

  if (!homeCountry) {
    return NextResponse.json(
      { error: "Home country is required." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Consent must match the current published agreement version.
  const { data: currentAgreement } = await getCurrentConsentAgreement(supabase);
  if (!currentAgreement) {
    return NextResponse.json(
      { error: "Consent agreement is not configured. Please contact support." },
      { status: 500 }
    );
  }
  if (!consent_version || consent_version !== currentAgreement.version) {
    return NextResponse.json(
      { error: "You must accept the current Privacy & Data Processing Agreement to submit your application." },
      { status: 400 }
    );
  }

  // Verify program exists, is active, and open for applications
  const { data: program } = await getProgramPublicInfo(supabase, program_id);

  if (!program || program.status !== "active" || !program.application_open) {
    return NextResponse.json(
      { error: "This program is not currently accepting applications" },
      { status: 400 }
    );
  }

  // Track selection (migration 221) — fetch this program's segments so we
  // can validate the submission and build a readable label. Every ordinary
  // program has none, so this is a no-op for them. The generated Supabase
  // types predate billing_courses (095/098), so this reads via an `any`
  // cast the same way the admin billing surfaces already do.
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

  // Validate required questions
  const { data: questions } = await getQuestionsByProgram(supabase, program_id);
  const questionList = (questions ?? []) as Array<{
    id: string;
    type: string;
    label: string;
    is_required: boolean;
    system_key?: string | null;
  }>;

  // Name and email are required even when this school's form never asked.
  // A school with only the nationality / home-country system questions used
  // to fall through to applicant_email 'unknown@applicant.local' and no name.
  const identity = resolveApplicantIdentity({
    questions: questionList,
    answers,
    firstName: body.first_name,
    lastName: body.last_name,
    email: body.email,
  });
  if (!identity.ok) {
    return NextResponse.json({ error: identity.error }, { status: 400 });
  }
  const { firstName, lastName, email } = identity.identity;
  const answersWithIdentity = withIdentityAnswers(
    answers,
    identity.identity,
    identityGaps(questionList)
  );

  const requiredIds = new Set(
    questionList.filter((q) => q.is_required).map((q) => q.id)
  );

  for (const a of answers) {
    if (requiredIds.has(a.question_id) && !a.answer?.trim()) {
      return NextResponse.json(
        { error: `Please answer the required question: "${a.question_label}"` },
        { status: 400 }
      );
    }
  }

  // Validate required references. The client forms enforce this too, but the
  // public form's guard was easy to bypass (empty/partial references were
  // silently dropped and still accepted), so this is the authoritative check.
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, program_id);

  const submittedReferences: Array<{
    slot_id?: string;
    referee_name?: string;
    referee_email?: string;
  }> = Array.isArray(references) ? references : [];
  for (const slot of referenceSlots ?? []) {
    if (!slot.is_required) continue;
    const provided = submittedReferences.find(
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

  const selfReferee = selfRefereeError(submittedReferences, [email], referenceSlots ?? []);
  if (selfReferee) {
    return NextResponse.json({ error: selfReferee }, { status: 400 });
  }

  // Email was already checked. Refuse a second application for this school.
  {
    const { data: existing } = await getResponseByEmailAndProgram(
      supabase,
      email,
      program_id
    );

    if (existing) {
      return NextResponse.json(
        { error: "An application with this email has already been submitted for this program" },
        { status: 409 }
      );
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .ilike("email", applicantEmailIlikePattern(email))
      .maybeSingle();

    if (existingUser) {
      const { data: existingUserResponse } = await supabase
        .from("application_responses")
        .select("id")
        .eq("user_id", existingUser.id)
        .eq("program_id", program_id)
        .maybeSingle();

      if (existingUserResponse) {
        return NextResponse.json(
          { error: "An application with this email has already been submitted for this program" },
          { status: 409 }
        );
      }
    }
  }

  // Build applicant_info from answers. Always store the name we accepted,
  // including an empty last name, so a missing key is not later rendered
  // as the word "undefined". Never the placeholder address.
  const applicantInfo: Record<string, unknown> = {};
  applicantInfo.email = email;
  applicantInfo.first_name = firstName;
  applicantInfo.last_name = lastName;
  // Nationality is now collected explicitly (no longer copied from home
  // country) and is the field accept-application reads onto users.nationality,
  // which drives the fee tier via country_tiers (keyed on country names).
  // Home country is kept separately as the applicant's country of residence.
  applicantInfo.nationality = nationality;
  applicantInfo.home_country = homeCountry;
  // Gender is asked as a normal program question (not a system field), so pull
  // it off the answers and normalise it onto applicant_info — mirroring
  // nationality — so the demographics dashboard can read it without depending on
  // the applicant's profile. Unrecognised answers are simply not stored.
  const gender = normaliseGender(findAnswerByLabel(answersWithIdentity, ["gender"]));
  if (gender) applicantInfo.gender = gender;
  if (files && Array.isArray(files) && files.length > 0) {
    applicantInfo.files = files;
  }

  // Surface nationality + home country in the answers list so reviewers see them.
  const savedAnswers: Array<{ question_id: string; question_label: string; answer: string }> = [
    { question_id: "nationality", question_label: "Nationality", answer: nationality },
    { question_id: "home_country", question_label: "Home Country", answer: homeCountry },
    ...answersWithIdentity.map((answer) => ({
      question_id: answer.question_id ?? "",
      question_label: answer.question_label ?? "",
      answer: answer.answer ?? "",
    })),
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
    savedAnswers.push({
      question_id: "program_track",
      question_label: "Which part are you applying for?",
      answer: label,
    });
  }

  const { data: response, error: insertError } = await createPublicResponse(
    supabase,
    {
      program_id,
      applicant_email: email,
      applicant_info: applicantInfo,
      answers: savedAnswers,
    }
  );

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to submit application. Please try again." },
      { status: 500 }
    );
  }

  // Persist the track choice (migration 221) — best-effort, never blocks
  // the submission the applicant is waiting on.
  if (segmentById.size > 0) {
    const rows = trackIsWholeProgram
      ? [{ application_response_id: response.id, billing_course_id: null }]
      : trackSegmentIds.map((id) => ({
          application_response_id: response.id,
          billing_course_id: id,
        }));
    const { error: segmentInsertError } = await segmentDb
      .from("application_segment_choices")
      .insert(rows);
    if (segmentInsertError) {
      console.error("[applications] segment choice insert failed", segmentInsertError);
    }
  }

  // Fire-and-forget Slack notification — never blocks the applicant's
  // submission.
  void notifyApplicationSubmitted({
    applicantName: [firstName, lastName].filter(Boolean).join(" ") || null,
    programName: program.name,
    programId: program_id,
    applicantEmail: email ?? null,
  }).catch((err) =>
    console.error("[applications] slack notify failed", err)
  );

  // Applicants join the CRM contact base (email-deduped) and are tagged
  // "FFSA Family". Fire-and-forget — never blocks or fails the submission.
  void syncApplicantToContact(supabase, {
    email,
    firstName,
    lastName,
    nationality,
    homeCountry,
    userId: null,
    programId: program_id,
    programCode: program.code,
    applicationId: response.id,
  }).catch((err) =>
    console.error("[applications] contact sync failed", err)
  );

  // Record the consent acceptance. We deliberately don't fail the submission
  // on this insert — the agreement version was already validated above, and
  // losing the audit row is less harmful than losing the application.
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const userAgent = request.headers.get("user-agent");
  await recordConsent(supabase, {
    agreement_version: consent_version,
    source: "application",
    applicant_email: email ?? response.applicant_email ?? null,
    application_id: response.id,
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Create reference requests and send emails to referees
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";

  // Send confirmation email if we have one (include status tracker link)
  const statusTrackerUrl = response.status_token
    ? `${siteUrl}/apply/status/${response.status_token}`
    : null;

  // References the applicant actually supplied — the creation loop below skips
  // partials the same way, so this matches the referee emails we're about to
  // send. Drives the confirmation email's references panel.
  const suppliedReferenceCount = submittedReferences.filter(
    (ref) => ref.slot_id && ref.referee_name?.trim() && ref.referee_email?.trim()
  ).length;

  // "sent" only when Resend accepted it. A school that turned this
  // template off is "skipped" — the page stays neutral. "failed" is a
  // real send error, and that is the only case that says so.
  let confirmationStatus: "sent" | "skipped" | "failed" = "failed";
  const greetingName = firstName || lastName || "Applicant";
  try {
    const receivedDefaults = {
      subject: `Application Received — ${program.name}`,
      html: applicationConfirmationEmailHtml({
        firstName: greetingName,
        programName: program.name,
        statusUrl: statusTrackerUrl,
        referenceCount: suppliedReferenceCount,
      }),
    };
    const resolved = await resolveProgramEmail(
      supabase,
      program_id,
      "application_received",
      receivedDefaults,
      {
        values: {
          first_name: greetingName,
          program_name: program.name,
        },
        cta: statusTrackerUrl
          ? { label: "Track your application", url: statusTrackerUrl }
          : undefined,
        // Re-appended even if a school rewrote this email's copy: an applicant
        // must not be told to sit tight without being told what's outstanding.
        notice:
          suppliedReferenceCount > 0
            ? applicationReferenceNotice(suppliedReferenceCount, {
                hasTracker: !!statusTrackerUrl,
              })
            : null,
        siteUrl,
      }
    );
    if (resolved.skip) {
      confirmationStatus = "skipped";
    } else {
      const sent = await sendTransactional({
        to: email,
        subject: resolved.subject,
        html: resolved.html,
        category: "application_received",
        sourceType: "school_application",
        sourceId: response.id,
        programDocuments: { programId: program_id, emailType: "application_received" },
      });
      confirmationStatus = sent.ok === true ? "sent" : "failed";
    }
  } catch (err) {
    console.error("[applications] confirmation email failed", err);
    confirmationStatus = "failed";
  }
  const referenceLinks: Array<{ label: string; url: string }> = [];

  if (references && Array.isArray(references) && references.length > 0) {
    const slotMap = new Map<string, any>((referenceSlots ?? []).map((s: any) => [s.id, s]));
    const applicantName = [firstName, lastName].filter(Boolean).join(" ") || "An applicant";

    for (const ref of references) {
      if (!ref.slot_id || !ref.referee_name || !ref.referee_email) continue;

      const { data: refRequest } = await createReferenceRequest(supabase, {
        application_id: response.id,
        slot_id: ref.slot_id,
        referee_name: ref.referee_name,
        referee_email: ref.referee_email,
      });

      if (refRequest) {
        const slot = slotMap.get(ref.slot_id);
        const referenceUrl = `${siteUrl}/reference/${refRequest.token}`;

        referenceLinks.push({
          label: slot?.label ?? "Reference",
          url: referenceUrl,
        });

        const sent = await sendReferenceInvite({
          toEmail: ref.referee_email,
          refereeName: ref.referee_name,
          applicantName,
          programName: program.name,
          slotLabel: slot?.label ?? "Reference",
          token: refRequest.token,
          programId: program_id,
          referenceRequestId: refRequest.id,
        });

        if (referenceSendConfirmed(sent)) {
          await (supabase as any)
            .from("reference_requests")
            .update({ email_sent_at: new Date().toISOString() })
            .eq("id", refRequest.id);
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    id: response.id,
    statusUrl: statusTrackerUrl,
    referenceLinks,
    confirmationEmailed: confirmationStatus === "sent",
    confirmationStatus,
  });
}
