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
import { sendTransactional } from "@/lib/email/send-transactional";
import { resolveProgramEmail } from "@/lib/email/render-program-email";
import { applicationConfirmationEmailHtml } from "@/lib/email/templates/application-confirmation";
import { referenceRequestEmailHtml } from "@/lib/email/templates/reference-request";


function findAnswerByType(
  answers: Array<{ question_id: string; question_label: string; answer: string }>,
  questions: Array<{ id: string; type: string; label: string }>,
  type: string
): string | null {
  const questionIds = new Set(questions.filter((q) => q.type === type).map((q) => q.id));
  const match = answers.find((a) => questionIds.has(a.question_id) && a.answer?.trim());
  return match?.answer?.trim() || null;
}

function findAnswerByLabel(
  answers: Array<{ question_id: string; question_label: string; answer: string }>,
  patterns: string[]
): string | null {
  for (const pattern of patterns) {
    const match = answers.find(
      (a) => a.question_label.toLowerCase().includes(pattern) && a.answer?.trim()
    );
    if (match) return match.answer.trim();
  }
  return null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { program_id, answers, references, files, consent_version } = body;
  const homeCountry =
    typeof body.home_country === "string" ? body.home_country.trim() : "";
  const nationality =
    typeof body.nationality === "string" ? body.nationality.trim() : "";

  if (!program_id || !answers) {
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

  // Validate required questions
  const { data: questions } = await getQuestionsByProgram(supabase, program_id);
  const requiredIds = new Set(
    (questions ?? []).filter((q: { is_required: boolean }) => q.is_required).map((q: { id: string }) => q.id)
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

  // Try to extract email from answers (look for email-type question first, then label match)
  const email = findAnswerByType(answers, questions ?? [], "email")
    ?? findAnswerByLabel(answers, ["email"]);

  // Try to extract name from answers
  const firstName = findAnswerByLabel(answers, ["first name", "first_name"])
    ?? findAnswerByLabel(answers, ["name"]);
  const lastName = findAnswerByLabel(answers, ["last name", "last_name", "surname"]);

  // Check for duplicate if we have an email
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

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
      .eq("email", email)
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

  // Build applicant_info from answers
  const applicantInfo: Record<string, unknown> = {};
  if (email) applicantInfo.email = email;
  if (firstName) applicantInfo.first_name = firstName;
  if (lastName) applicantInfo.last_name = lastName;
  // Nationality is now collected explicitly (no longer copied from home
  // country) and is the field accept-application reads onto users.nationality,
  // which drives the fee tier via country_tiers (keyed on country names).
  // Home country is kept separately as the applicant's country of residence.
  applicantInfo.nationality = nationality;
  applicantInfo.home_country = homeCountry;
  if (files && Array.isArray(files) && files.length > 0) {
    applicantInfo.files = files;
  }

  // Surface nationality + home country in the answers list so reviewers see them.
  const answersWithCountry = [
    { question_id: "nationality", question_label: "Nationality", answer: nationality },
    { question_id: "home_country", question_label: "Home Country", answer: homeCountry },
    ...answers,
  ];

  const { data: response, error: insertError } = await createPublicResponse(
    supabase,
    {
      program_id,
      applicant_email: email || "unknown@applicant.local",
      applicant_info: applicantInfo,
      answers: answersWithCountry,
    }
  );

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to submit application. Please try again." },
      { status: 500 }
    );
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

  if (email) {
    const receivedDefaults = {
      subject: `Application Received — ${program.name}`,
      html: applicationConfirmationEmailHtml({
        firstName: firstName || "Applicant",
        programName: program.name,
        statusUrl: statusTrackerUrl,
      }),
    };
    const resolved = await resolveProgramEmail(
      supabase,
      program_id,
      "application_received",
      receivedDefaults,
      {
        values: {
          first_name: firstName || "Applicant",
          program_name: program.name,
        },
        cta: statusTrackerUrl
          ? { label: "Track your application", url: statusTrackerUrl }
          : undefined,
        siteUrl,
      }
    );
    if (!resolved.skip) {
      await sendTransactional({
        to: email,
        subject: resolved.subject,
        html: resolved.html,
        category: "application_received",
        sourceType: "school_application",
        sourceId: response.id,
      });
    }
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

        const refDefaults = {
          subject: `Reference Request — ${program.name}`,
          html: referenceRequestEmailHtml({
            refereeName: ref.referee_name,
            applicantName,
            programName: program.name,
            slotLabel: slot?.label ?? "Reference",
            referenceUrl,
          }),
        };
        const resolvedRef = await resolveProgramEmail(
          supabase,
          program_id,
          "reference_request",
          refDefaults,
          {
            values: {
              program_name: program.name,
              applicant_name: applicantName,
              referee_name: ref.referee_name,
              reference_type: slot?.label ?? "Reference",
            },
            cta: { label: "Complete the reference", url: referenceUrl },
            siteUrl,
          }
        );
        if (!resolvedRef.skip) {
          await sendTransactional({
            to: ref.referee_email,
            subject: resolvedRef.subject,
            html: resolvedRef.html,
            category: "reference_request",
            sourceType: "school_application",
            sourceId: response.id,
          });
        }

        await (supabase as any)
          .from("reference_requests")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", refRequest.id);
      }
    }
  }

  return NextResponse.json({ success: true, id: response.id, referenceLinks });
}
