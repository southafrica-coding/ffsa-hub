import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createReferenceRequest } from "@/services/schools";
import { sendReferenceInvite } from "@/lib/email/send-reference-invite";
import { referenceSendConfirmed } from "@/lib/email/reference-email";
import { isSelfReferee, loadApplicantEmails, REFEREE_CHECK_FAILED, SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST — applicant self-serve: ADD a reference for a slot that has no request
// yet. This is the counterpart to the PATCH handler in ../route.ts (which only
// edits an existing referee). Authorized by the application's status_token — the
// same trust model as the status page — NOT a login. Used to backfill the
// references that older applications were allowed to skip before submit-time
// enforcement was added.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const status_token = body?.status_token;
  const slot_id = body?.slot_id;
  const refereeName =
    typeof body?.referee_name === "string" ? body.referee_name.trim() : "";
  const refereeEmail =
    typeof body?.referee_email === "string" ? body.referee_email.trim() : "";

  if (!status_token || !slot_id) {
    return NextResponse.json(
      { error: "status_token and slot_id are required" },
      { status: 400 }
    );
  }
  if (!refereeName) {
    return NextResponse.json(
      { error: "Please enter the reference's name." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(refereeEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Resolve the application from its status_token.
  const { data: application } = await supabase
    .from("application_responses")
    .select("id, program_id, applicant_info, programs(name)")
    .eq("status_token", status_token)
    .single();

  if (!application) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 }
    );
  }

  // The slot must belong to this application's program (guards against adding a
  // reference for an unrelated slot id).
  const { data: slot } = await supabase
    .from("reference_slots")
    .select("id, label, program_id")
    .eq("id", slot_id)
    .single();

  if (!slot || slot.program_id !== application.program_id) {
    return NextResponse.json(
      { error: "That reference is not part of this application." },
      { status: 400 }
    );
  }

  // One reference per (application, slot). If a row already exists, the applicant
  // should edit it (PATCH) rather than add a duplicate — surface a friendly 409
  // instead of letting the UNIQUE(application_id, slot_id) constraint 500.
  const { data: existing } = await supabase
    .from("reference_requests")
    .select("id")
    .eq("application_id", application.id)
    .eq("slot_id", slot_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A reference for this slot has already been added." },
      { status: 409 }
    );
  }

  const loaded = await loadApplicantEmails(supabase, application.id);
  if (loaded.error) {
    console.error("[references/add] applicant email lookup failed", loaded.error);
    return NextResponse.json({ error: REFEREE_CHECK_FAILED }, { status: 500 });
  }
  if (isSelfReferee(refereeEmail, loaded.emails)) {
    return NextResponse.json({ error: SELF_REFEREE_MESSAGE }, { status: 400 });
  }

  const { data: refRequest, error } = await createReferenceRequest(supabase, {
    application_id: application.id,
    slot_id,
    referee_name: refereeName,
    referee_email: refereeEmail,
  });

  if (error || !refRequest) {
    if (error?.message === SELF_REFEREE_MESSAGE) {
      return NextResponse.json({ error: SELF_REFEREE_MESSAGE }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Couldn't save your reference. Please try again." },
      { status: 500 }
    );
  }

  // Send the standard referee invite. email_sent_at is stamped only when the
  // provider returns a message id. A failed send doesn't undo the saved row —
  // the applicant can correct the address from the status page.
  const applicantInfo = application.applicant_info as Record<string, string> | null;
  const applicantName =
    [applicantInfo?.first_name, applicantInfo?.last_name].filter(Boolean).join(" ") ||
    "the applicant";
  const programName =
    (application.programs as { name: string } | null)?.name ?? "School Program";

  let emailed = false;
  try {
    const sent = await sendReferenceInvite({
      toEmail: refereeEmail,
      refereeName,
      applicantName,
      programName,
      slotLabel: slot.label,
      token: refRequest.token,
      programId: application.program_id,
      referenceRequestId: refRequest.id,
    });
    if (referenceSendConfirmed(sent)) {
      await supabase
        .from("reference_requests")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", refRequest.id);
      emailed = true;
    }
  } catch {
    emailed = false;
  }

  return NextResponse.json({
    success: true,
    emailed,
    reference: {
      id: refRequest.id,
      status: refRequest.status,
      referee_name: refereeName,
      referee_email: refereeEmail,
      slot_label: slot.label,
    },
  });
}
