import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { accessModeOf, formAccessDecision } from "@/lib/forms/access";
import { getFormBySlug } from "@/services/forms";
import { upsertContactWithDedup } from "@/services/contact-upsert";
import { addLabelToContact } from "@/services/labels";
import { applyEventLabelsToContact } from "@/services/event-labels";
import { logActivity, logLabelAdded, logFormSubmitted } from "@/services/activity-events";
import {
  getActiveWorkflowsForOutcomes,
  getActiveEnrollment,
  createEnrollment,
} from "@/services/workflows";
import { runEnrollment } from "@/lib/workflows/runner";
import { evaluateTrigger, type WorkflowTrigger } from "@/lib/workflows/types";
import {
  isContactFieldKey,
  validateSubmission,
  fieldKey,
  type FormSchema,
} from "@/lib/forms/schema";
import type { Json } from "@/types/database";

// POST /api/f/[slug]/submit — public form submission. No auth: runs
// through the service-role admin client. Spam protection (Turnstile)
// is a planned follow-up (env keys to be added).
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const supabase = createAdminClient();

  const { data: form, error: formErr } = await getFormBySlug(supabase, slug);
  if (formErr || !form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }
  if (!form.is_active) {
    return NextResponse.json({ error: "This form is not currently open" }, { status: 403 });
  }

  // Same rule as the page (migration 390): logged_in needs a Hub session,
  // token forms stay closed until per-subject links exist.
  const accessMode = accessModeOf((form as { access_mode?: unknown }).access_mode);
  if (accessMode !== "public") {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    const decision = formAccessDecision(accessMode, Boolean(user));
    if (decision === "sign_in") {
      return NextResponse.json({ error: "Sign in to the Hub to send this form" }, { status: 401 });
    }
    if (decision === "closed") {
      return NextResponse.json({ error: "This form opens from a personal link" }, { status: 403 });
    }
  }

  let body: { data?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data = body.data ?? {};

  const schema = form.schema as unknown as FormSchema;
  const validation = validateSubmission(schema, data);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  // Split submitted answers into contact columns vs custom raw-only data.
  const contactFields: Record<string, unknown> = {};
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (isContactFieldKey(field.key)) {
        const v = data[field.key];
        if (v != null && v !== "") contactFields[field.key] = v;
      }
    }
  }

  // 1. Dedup-upsert the contact, applying the form's base label.
  const upsert = await upsertContactWithDedup(supabase, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contact: contactFields as any,
    labelId: form.label_id,
    addedVia: `form:${form.id}`,
    userId: null,
    source: `form:${form.slug}`,
    reviewSource: { type: "form", id: form.id },
  });

  if (upsert.error || !upsert.data) {
    return NextResponse.json(
      { error: (upsert.error as { message?: string })?.message ?? "Submission failed" },
      { status: 500 }
    );
  }

  const outcome = upsert.data;
  const contactId = outcome.action === "queued_for_review" ? null : outcome.contactId;
  const dedupAction = outcome.action === "created" ? "new" : outcome.action;

  // 2. Record the submission.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = request.headers.get("user-agent") ?? null;
  const { data: submission, error: subErr } = await supabase
    .from("form_submissions")
    .insert({
      form_id: form.id,
      contact_id: contactId,
      raw_data: data as Json,
      ip_address: ip,
      user_agent: ua,
      dedup_action: dedupAction,
    })
    .select("id")
    .single();
  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  // If the contact was queued for manual review, stop here — labels and
  // outcome responses get applied when staff resolves the conflict.
  if (!contactId) {
    return NextResponse.json({ ok: true, status: "queued_for_review" });
  }

  // 2b. The rest of the event's label set (migration 193). The form's
  //     own label_id was applied by the dedup upsert; an event with
  //     several base labels applies all of them to the respondent.
  if (form.event_id) {
    await applyEventLabelsToContact(supabase, {
      eventId: form.event_id,
      contactId,
      addedVia: `form:${form.id}`,
      userId: null,
      skip: [form.label_id],
    });
  }

  // 3. Outcome responses — for every checked outcome field.
  const respondedOutcomeIds = new Set<string>();
  for (const step of schema.steps) {
    for (const field of step.fields) {
      if (field.type !== "outcome" || !field.outcomeId) continue;
      if (data[fieldKey(field)] !== true) continue;
      respondedOutcomeIds.add(field.outcomeId);

      const { data: oc } = await supabase
        .from("event_outcomes")
        .select("label_id")
        .eq("id", field.outcomeId)
        .maybeSingle();

      if (oc?.label_id) {
        const added = await addLabelToContact(supabase, {
          contact_id: contactId,
          label_id: oc.label_id,
          added_via: `form:${form.id}`,
          added_by: null,
        });
        if (added.data) {
          await logLabelAdded(supabase, {
            contactId,
            labelId: oc.label_id,
            addedVia: `form:${form.id}`,
            userId: null,
          });
        }
      }

      await supabase
        .from("event_outcome_responses")
        .upsert(
          {
            outcome_id: field.outcomeId,
            contact_id: contactId,
            form_submission_id: submission.id,
          },
          { onConflict: "outcome_id,contact_id", ignoreDuplicates: true }
        );
    }
  }

  // 4. Attendance — if the form is configured to record it.
  if (form.records_attendance && form.event_id) {
    await supabase
      .from("event_registrations")
      .upsert(
        { contact_id: contactId, event_id: form.event_id, status: "confirmed" },
        { onConflict: "contact_id,event_id", ignoreDuplicates: true }
      );
  }

  // 5. Timeline event.
  await logFormSubmitted(supabase, {
    contactId,
    formId: form.id,
    submissionId: submission.id,
  });

  // 6. Workflow enrollment — enroll the contact into any active workflow
  //    whose trigger matches this submission, then run the first (instant)
  //    steps inline so the welcome email goes out immediately. Never fail
  //    the submission because of a workflow problem.
  try {
    const candidateOutcomeIds = new Set<string>(respondedOutcomeIds);
    // The outcome whose dedicated form this is (1:1 link, migration 070).
    const { data: linkedOutcomes } = await supabase
      .from("event_outcomes")
      .select("id")
      .eq("form_id", form.id);
    for (const o of (linkedOutcomes ?? []) as Array<{ id: string }>) {
      candidateOutcomeIds.add(o.id);
    }

    if (candidateOutcomeIds.size > 0) {
      const { data: workflows } = await getActiveWorkflowsForOutcomes(
        supabase,
        Array.from(candidateOutcomeIds)
      );
      for (const wf of (workflows ?? []) as Array<{
        id: string;
        name: string;
        trigger: unknown;
      }>) {
        if (!evaluateTrigger(wf.trigger as WorkflowTrigger | null, data)) continue;

        const existing = await getActiveEnrollment(supabase, wf.id, contactId);
        if (existing.data) continue; // already mid-flight for this contact

        const enrolled = await createEnrollment(supabase, {
          workflow_id: wf.id,
          contact_id: contactId,
          form_submission_id: submission.id,
          status: "active",
          current_step: 0,
          next_run_at: new Date().toISOString(),
        });
        if (enrolled.data) {
          await logActivity(supabase, {
            contact_id: contactId,
            event_type: "workflow_enrolled",
            payload: { workflow_id: wf.id, workflow_name: wf.name },
          });
          await runEnrollment(supabase, enrolled.data);
        }
      }
    }
  } catch (e) {
    console.error("[form submit] workflow enrollment failed", e);
  }

  return NextResponse.json({
    ok: true,
    status: outcome.action,
    redirectUrl: form.redirect_url ?? null,
  });
}
