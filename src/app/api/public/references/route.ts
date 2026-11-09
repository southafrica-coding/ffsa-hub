import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReferenceRequestByToken, submitReference } from "@/services/schools";
import {
  editReferenceContact,
  REFERENCE_EDIT_SELECT,
} from "@/lib/references/edit-reference-contact";
import { maybeNotifyReferencesComplete } from "@/lib/references/notify-references-complete";
import { advanceApplicationWhenReferencesComplete } from "@/lib/references/advance-reference-stage";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await getReferenceRequestByToken(supabase, token);

  if (error || !data) {
    return NextResponse.json(
      { error: "Reference request not found" },
      { status: 404 }
    );
  }

  const app = data.application_responses as any;
  const applicantName = app?.applicant_info
    ? [app.applicant_info.first_name, app.applicant_info.last_name].filter(Boolean).join(" ") || "the applicant"
    : "the applicant";

  return NextResponse.json({
    status: data.status,
    referee_name: data.referee_name,
    slot_label: (data.reference_slots as any)?.label ?? "Reference",
    slot_description: (data.reference_slots as any)?.description ?? null,
    applicant_name: applicantName,
    program_name: app?.programs?.name ?? "the program",
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    token,
    relationship,
    known_duration,
    reference_text,
    form_data,
    answers,
  } = body;

  if (!token) {
    return NextResponse.json(
      { error: "token is required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: existing } = await getReferenceRequestByToken(supabase, token);
  if (!existing) {
    return NextResponse.json(
      { error: "Reference request not found" },
      { status: 404 }
    );
  }
  if (existing.status === "submitted") {
    return NextResponse.json(
      { error: "Reference has already been submitted" },
      { status: 409 }
    );
  }

  // Two payload shapes are accepted:
  //   - Legacy:  { relationship, known_duration, reference_text, form_data: {...flat keys} }
  //   - Current: { answers: [{question_id, question_label, answer}, ...] }
  // The dynamic referee form always sends the second; the first stays for any
  // unmigrated client. We persist current submissions as form_data.answers so
  // the admin display can render labels from the question snapshot.
  let payloadFormData: Record<string, unknown>;
  let payloadRelationship = relationship || "";
  let payloadKnownDuration = known_duration || "";
  let payloadReferenceText = reference_text || "";

  if (Array.isArray(answers) && answers.length > 0) {
    payloadFormData = { answers };

    // Best-effort fill of the legacy columns so admin lists / analytics that
    // still query them keep working until they're migrated.
    const findAnswerByLabel = (patterns: string[]) => {
      for (const pattern of patterns) {
        const match = (answers as Array<{ question_label: string; answer: string }>).find(
          (a) => a.question_label?.toLowerCase().includes(pattern) && a.answer?.trim()
        );
        if (match) return match.answer.trim();
      }
      return "";
    };
    if (!payloadRelationship) {
      payloadRelationship = findAnswerByLabel(["relationship"]);
    }
    if (!payloadKnownDuration) {
      payloadKnownDuration = findAnswerByLabel(["how long", "known the applicant"]);
    }
    if (!payloadReferenceText) {
      payloadReferenceText = findAnswerByLabel([
        "strengths and weaknesses",
        "strengths",
      ]);
    }
  } else {
    payloadFormData = form_data || {};
  }

  const { data, error } = await submitReference(supabase, token, {
    relationship: payloadRelationship,
    known_duration: payloadKnownDuration,
    reference_text: payloadReferenceText,
    form_data: payloadFormData,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If this was the last required reference, move an early-stage application
  // to references_received. That write does not email anyone. The staff
  // notification below is the one that already existed; it stays
  // self-contained so neither step can change the 200 the referee receives.
  const applicationId = (existing.application_responses as any)?.id;
  if (applicationId) {
    await advanceApplicationWhenReferencesComplete(supabase, applicationId);
    await maybeNotifyReferencesComplete(supabase, applicationId);
  }

  return NextResponse.json({ success: true, reference: data });
}

// PATCH — applicant self-serve: swap out a pending reference's contact
// (name/email) from their application-status page. Authorized by the
// application's status_token, NOT a login — the same trust model as the
// status page itself. A changed email regenerates the invite token and
// re-sends the invite to the corrected address.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const status_token = body?.status_token;
  const reference_request_id = body?.reference_request_id;

  if (!status_token || !reference_request_id) {
    return NextResponse.json(
      { error: "status_token and reference_request_id are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data: ref } = await supabase
    .from("reference_requests")
    .select(REFERENCE_EDIT_SELECT)
    .eq("id", reference_request_id)
    .single();

  if (!ref) {
    return NextResponse.json(
      { error: "Reference request not found" },
      { status: 404 }
    );
  }

  // Authorize: the reference must belong to the application this status_token
  // unlocks. Guards against editing another applicant's references.
  if ((ref.application_responses as any)?.status_token !== status_token) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const result = await editReferenceContact(supabase, ref, {
    referee_name: body?.referee_name,
    referee_email: body?.referee_email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    emailed: result.emailed,
    email_changed: result.emailChanged,
  });
}
