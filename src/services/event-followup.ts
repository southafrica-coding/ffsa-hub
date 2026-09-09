import { getActiveSchedulingForEnrollment } from "./scheduling";
import { fieldKey, type FormField, type FormSchema } from "@/lib/forms/schema";

// Event Follow-up queue service. Reads workflow_enrollments joined to
// contacts, workflows, outcomes, events, and assigned staff — then
// synthesizes a human-readable "stage" label by combining the latest
// workflow_step_runs entry with the next workflow_steps entry.
//
// The row entity is one workflow_enrollment. A person enrolled in
// multiple workflows shows as multiple rows; this is intentional — each
// row tracks an independent automation chain that may need different
// follow-up.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type Json = Record<string, unknown> | null;

export type FollowupQueueRow = {
  enrollment_id: string;
  enrolled_at: string;
  status: "active" | "completed" | "cancelled";
  current_step: number;
  next_run_at: string | null;

  assigned_staff_id: string | null;
  staff_assigned_at: string | null;
  staff_viewed_at: string | null;
  marked_finished_at: string | null;

  staff_notes: string | null;
  staff_notes_updated_at: string | null;
  staff_notes_updated_by: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  } | null;

  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    phone: string | null;
  };

  workflow: { id: string; name: string };
  outcome: { id: string; name: string };
  event: { id: string; title: string };

  // Every outcome this contact chose on the form for this event (their FULL
  // selection, not just the active-workflow one). `active` = the outcome still
  // has an active enrollment in the queue (vs a completed single-email one).
  // Populated by the queue; the detail fetch leaves it undefined.
  chosen_outcomes?: { id: string; name: string; active: boolean }[];

  assigned_staff: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  } | null;

  // Synthesized
  stage_label: string;
  total_steps: number;
  steps_done: number;
  days_in_pipeline: number;
  is_unread: boolean; // true if assigned but staff_viewed_at is null
};

type StepRow = {
  id: string;
  workflow_id: string;
  sort_order: number;
  step_type: "send_email" | "delay" | "assign_label";
  config: Json;
};

type RunRow = {
  enrollment_id: string;
  step_id: string | null;
  status: "done" | "failed" | "skipped";
  ran_at: string;
};

// ─────────────────────────────────────────────────────────────────
// Stage label synthesis (pure function — exported for unit tests)
// ─────────────────────────────────────────────────────────────────

function stepTypeLabel(step: StepRow | null | undefined): string {
  if (!step) return "step";
  switch (step.step_type) {
    case "send_email": {
      const subject =
        (step.config as { subject?: string } | null)?.subject ?? "email";
      return `email "${subject}"`;
    }
    case "delay": {
      const days = (step.config as { days?: number } | null)?.days ?? 0;
      return `${days}-day wait`;
    }
    case "assign_label":
      return "label assignment";
    default:
      return "step";
  }
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function synthesizeStageLabel(args: {
  status: "active" | "completed" | "cancelled";
  current_step: number;
  next_run_at: string | null;
  steps: StepRow[]; // for this enrollment's workflow only, sorted by sort_order
  latestRun: RunRow | null;
  nowIso: string;
}): { label: string; total: number; done: number } {
  const total = args.steps.length;
  const done = Math.min(args.current_step, total);

  if (args.status === "cancelled") {
    return { label: "Cancelled", total, done };
  }
  if (args.status === "completed") {
    return { label: "Workflow complete", total, done };
  }

  const nextStep = args.steps[args.current_step] ?? null;
  const lastStep = args.latestRun?.step_id
    ? args.steps.find((s) => s.id === args.latestRun!.step_id) ?? null
    : null;

  if (!lastStep && nextStep) {
    return {
      label: `Starting · next ${stepTypeLabel(nextStep)}`,
      total,
      done,
    };
  }

  if (lastStep && !nextStep) {
    return { label: `Just ran ${stepTypeLabel(lastStep)}`, total, done };
  }

  if (lastStep && nextStep) {
    let suffix = `next ${stepTypeLabel(nextStep)}`;
    if (nextStep.step_type === "delay" && args.next_run_at) {
      const d = daysBetween(args.nowIso, args.next_run_at);
      if (d > 0) suffix = `waiting ${d}d, ${suffix}`;
    } else if (args.next_run_at) {
      const d = daysBetween(args.nowIso, args.next_run_at);
      if (d > 0) suffix = `${suffix} in ${d}d`;
    }
    return { label: `Sent ${stepTypeLabel(lastStep)} · ${suffix}`, total, done };
  }

  return { label: "Just enrolled", total, done };
}

// ─────────────────────────────────────────────────────────────────
// Queue fetch
// ─────────────────────────────────────────────────────────────────

export async function getFollowupQueue(
  supabase: Client,
  options: {
    accessibleEventIds: Set<string> | null; // null = all events (admin)
  }
): Promise<FollowupQueueRow[]> {
  const q = supabase
    .from("workflow_enrollments")
    .select(
      `
        id, enrolled_at, status, current_step, next_run_at,
        assigned_staff_id, staff_assigned_at, staff_viewed_at, marked_finished_at,
        staff_notes, staff_notes_updated_at,
        contact:contacts!workflow_enrollments_contact_id_fkey(
          id, first_name, last_name, preferred_name, email, phone
        ),
        workflow:outcome_workflows!workflow_enrollments_workflow_id_fkey(
          id, name,
          outcome:event_outcomes!outcome_workflows_outcome_id_fkey(
            id, name, event_id,
            event:events!event_outcomes_event_id_fkey(id, title)
          )
        ),
        assigned_staff:users!workflow_enrollments_assigned_staff_id_fkey(
          id, first_name, last_name, preferred_name, email
        ),
        staff_notes_updated_by:users!workflow_enrollments_staff_notes_updated_by_fkey(
          id, first_name, last_name, preferred_name, email
        )
      `
    )
    .eq("status", "active")
    .is("marked_finished_at", null)
    .order("enrolled_at", { ascending: false })
    .limit(200);

  const { data, error } = await q;
  if (error || !data) return [];

  // Shape and filter by accessible events
  type Raw = {
    id: string;
    enrolled_at: string;
    status: "active" | "completed" | "cancelled";
    current_step: number;
    next_run_at: string | null;
    assigned_staff_id: string | null;
    staff_assigned_at: string | null;
    staff_viewed_at: string | null;
    marked_finished_at: string | null;
    staff_notes: string | null;
    staff_notes_updated_at: string | null;
    contact: FollowupQueueRow["contact"] | null;
    workflow: {
      id: string;
      name: string;
      outcome: {
        id: string;
        name: string;
        event_id: string;
        event: { id: string; title: string } | null;
      } | null;
    } | null;
    assigned_staff: FollowupQueueRow["assigned_staff"] | null;
    staff_notes_updated_by: FollowupQueueRow["staff_notes_updated_by"] | null;
  };

  const raws = (data as Raw[]).filter((r) => {
    if (!r.contact || !r.workflow?.outcome?.event) return false;
    if (options.accessibleEventIds === null) return true;
    return options.accessibleEventIds.has(r.workflow.outcome.event.id);
  });

  if (raws.length === 0) return [];

  const enrollmentIds = raws.map((r) => r.id);
  const workflowIds = Array.from(
    new Set(raws.map((r) => r.workflow!.id))
  );

  // Fetch workflow steps once for all involved workflows
  const { data: stepsData } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, sort_order, step_type, config")
    .in("workflow_id", workflowIds)
    .order("sort_order", { ascending: true });

  const stepsByWorkflow = new Map<string, StepRow[]>();
  for (const s of (stepsData ?? []) as StepRow[]) {
    const arr = stepsByWorkflow.get(s.workflow_id) ?? [];
    arr.push(s);
    stepsByWorkflow.set(s.workflow_id, arr);
  }

  // Fetch all step_runs for these enrollments (status='done' only),
  // newest first, then take the latest per enrollment in memory.
  const { data: runsData } = await supabase
    .from("workflow_step_runs")
    .select("enrollment_id, step_id, status, ran_at")
    .in("enrollment_id", enrollmentIds)
    .eq("status", "done")
    .order("ran_at", { ascending: false });

  const latestRunByEnrollment = new Map<string, RunRow>();
  for (const r of (runsData ?? []) as RunRow[]) {
    if (!latestRunByEnrollment.has(r.enrollment_id)) {
      latestRunByEnrollment.set(r.enrollment_id, r);
    }
  }

  // Every outcome each queued contact actually CHOSE on the form (from
  // event_outcome_responses) — so a row can show the full selection, not just
  // the outcome(s) whose workflow is still active. `active` is derived from the
  // active enrollments already in `raws`.
  const contactIds = Array.from(new Set(raws.map((r) => r.contact!.id)));
  const activeOutcomeKeys = new Set(
    raws.map((r) => `${r.contact!.id}:${r.workflow!.outcome!.id}`)
  );
  const chosenByContact = new Map<
    string,
    Array<{ id: string; name: string; event_id: string }>
  >();
  if (contactIds.length > 0) {
    const { data: respData } = await supabase
      .from("event_outcome_responses")
      .select("contact_id, event_outcomes(id, name, event_id)")
      .in("contact_id", contactIds);
    for (const row of (respData ?? []) as Array<{
      contact_id: string;
      event_outcomes: { id: string; name: string; event_id: string } | null;
    }>) {
      if (!row.event_outcomes) continue;
      const arr = chosenByContact.get(row.contact_id) ?? [];
      arr.push(row.event_outcomes);
      chosenByContact.set(row.contact_id, arr);
    }
  }

  const nowIso = new Date().toISOString();
  const rows: FollowupQueueRow[] = raws.map((r) => {
    const steps = stepsByWorkflow.get(r.workflow!.id) ?? [];
    const stage = synthesizeStageLabel({
      status: r.status,
      current_step: r.current_step,
      next_run_at: r.next_run_at,
      steps,
      latestRun: latestRunByEnrollment.get(r.id) ?? null,
      nowIso,
    });

    return {
      enrollment_id: r.id,
      enrolled_at: r.enrolled_at,
      status: r.status,
      current_step: r.current_step,
      next_run_at: r.next_run_at,
      assigned_staff_id: r.assigned_staff_id,
      staff_assigned_at: r.staff_assigned_at,
      staff_viewed_at: r.staff_viewed_at,
      marked_finished_at: r.marked_finished_at,
      staff_notes: r.staff_notes,
      staff_notes_updated_at: r.staff_notes_updated_at,
      staff_notes_updated_by: r.staff_notes_updated_by,
      contact: r.contact!,
      workflow: { id: r.workflow!.id, name: r.workflow!.name },
      outcome: {
        id: r.workflow!.outcome!.id,
        name: r.workflow!.outcome!.name,
      },
      event: {
        id: r.workflow!.outcome!.event!.id,
        title: r.workflow!.outcome!.event!.title,
      },
      chosen_outcomes: (chosenByContact.get(r.contact!.id) ?? [])
        .filter((o) => o.event_id === r.workflow!.outcome!.event!.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          active: activeOutcomeKeys.has(`${r.contact!.id}:${o.id}`),
        })),
      assigned_staff: r.assigned_staff,
      stage_label: stage.label,
      total_steps: stage.total,
      steps_done: stage.done,
      days_in_pipeline: daysBetween(r.enrolled_at, nowIso),
      is_unread: !!r.assigned_staff_id && !r.staff_viewed_at,
    };
  });

  return rows;
}

// ─────────────────────────────────────────────────────────────────
// Detail fetch (drawer)
// ─────────────────────────────────────────────────────────────────

export type FollowupDetail = FollowupQueueRow & {
  form_submission: {
    id: string;
    submitted_at: string;
    raw_data: Record<string, unknown> | null;
    field_labels: Record<string, string>; // raw_data key → question label
  } | null;
  workflow_steps: Array<{
    id: string;
    sort_order: number;
    step_type: string;
    config: Json;
  }>;
  step_runs: Array<{
    id: string;
    step_id: string | null;
    status: string;
    ran_at: string;
    detail: Json;
  }>;
  scheduling: {
    id: string;
    status: "pending" | "awaiting_selection" | "scheduled" | "cancelled";
    duration_minutes: number;
    message: string | null;
    magic_token: string;
    expires_at: string;
    scheduled_at: string | null;
    cancelled_at: string | null;
    created_at: string;
    slots: Array<{
      id: string;
      starts_at: string;
      ends_at: string;
      proposed_by: "recipient" | "team";
      is_chosen: boolean;
    }>;
  } | null;
};

export async function getFollowupDetail(
  supabase: Client,
  enrollmentId: string
): Promise<FollowupDetail | null> {
  const { data: enrollment } = await supabase
    .from("workflow_enrollments")
    .select(
      `
        id, enrolled_at, status, current_step, next_run_at, form_submission_id,
        assigned_staff_id, staff_assigned_at, staff_viewed_at, marked_finished_at,
        staff_notes, staff_notes_updated_at,
        contact:contacts!workflow_enrollments_contact_id_fkey(
          id, first_name, last_name, preferred_name, email, phone
        ),
        workflow:outcome_workflows!workflow_enrollments_workflow_id_fkey(
          id, name,
          outcome:event_outcomes!outcome_workflows_outcome_id_fkey(
            id, name, event_id,
            event:events!event_outcomes_event_id_fkey(id, title)
          )
        ),
        assigned_staff:users!workflow_enrollments_assigned_staff_id_fkey(
          id, first_name, last_name, preferred_name, email
        ),
        staff_notes_updated_by:users!workflow_enrollments_staff_notes_updated_by_fkey(
          id, first_name, last_name, preferred_name, email
        )
      `
    )
    .eq("id", enrollmentId)
    .single();

  if (!enrollment) return null;

  type EnrollRaw = {
    id: string;
    enrolled_at: string;
    status: "active" | "completed" | "cancelled";
    current_step: number;
    next_run_at: string | null;
    form_submission_id: string | null;
    assigned_staff_id: string | null;
    staff_assigned_at: string | null;
    staff_viewed_at: string | null;
    marked_finished_at: string | null;
    staff_notes: string | null;
    staff_notes_updated_at: string | null;
    contact: FollowupQueueRow["contact"] | null;
    workflow: {
      id: string;
      name: string;
      outcome: {
        id: string;
        name: string;
        event_id: string;
        event: { id: string; title: string } | null;
      } | null;
    } | null;
    assigned_staff: FollowupQueueRow["assigned_staff"] | null;
    staff_notes_updated_by: FollowupQueueRow["staff_notes_updated_by"] | null;
  };

  const e = enrollment as unknown as EnrollRaw;
  if (!e.contact || !e.workflow?.outcome?.event) return null;

  const { data: stepsData } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, sort_order, step_type, config")
    .eq("workflow_id", e.workflow.id)
    .order("sort_order", { ascending: true });

  const steps = (stepsData ?? []) as StepRow[];

  const { data: runsData } = await supabase
    .from("workflow_step_runs")
    .select("id, step_id, status, ran_at, detail")
    .eq("enrollment_id", enrollmentId)
    .order("ran_at", { ascending: true });

  const runs = (runsData ?? []) as Array<{
    id: string;
    step_id: string | null;
    status: string;
    ran_at: string;
    detail: Json;
  }>;

  const latestRun =
    runs.length > 0
      ? ({ ...runs[runs.length - 1], enrollment_id: enrollmentId } as RunRow)
      : null;

  const nowIso = new Date().toISOString();
  const stage = synthesizeStageLabel({
    status: e.status,
    current_step: e.current_step,
    next_run_at: e.next_run_at,
    steps,
    latestRun: latestRun
      ? { ...latestRun, status: latestRun.status as "done" }
      : null,
    nowIso,
  });

  // Optional form_submission fetch
  let formSubmission: FollowupDetail["form_submission"] = null;
  if (e.form_submission_id) {
    const { data: sub } = await supabase
      .from("form_submissions")
      .select("id, submitted_at, raw_data, form_id")
      .eq("id", e.form_submission_id)
      .single();
    if (sub) {
      // Map raw_data keys (contact keys + field ids) → the form's question
      // labels, so the drawer shows real questions, not "FIELD MPJFQWZ9 2".
      const fieldLabels: Record<string, string> = {};
      if (sub.form_id) {
        const { data: form } = await supabase
          .from("forms")
          .select("schema")
          .eq("id", sub.form_id)
          .maybeSingle();
        const schema = form?.schema as FormSchema | undefined;
        for (const st of schema?.steps ?? []) {
          for (const f of st.fields ?? []) {
            if (f?.label) fieldLabels[fieldKey(f)] = f.label;
          }
        }
      }
      formSubmission = {
        id: sub.id,
        submitted_at: sub.submitted_at,
        raw_data: sub.raw_data,
        field_labels: fieldLabels,
      };
    }
  }

  const scheduling = await getActiveSchedulingForEnrollment(
    supabase,
    enrollmentId
  );

  return {
    enrollment_id: e.id,
    enrolled_at: e.enrolled_at,
    status: e.status,
    current_step: e.current_step,
    next_run_at: e.next_run_at,
    assigned_staff_id: e.assigned_staff_id,
    staff_assigned_at: e.staff_assigned_at,
    staff_viewed_at: e.staff_viewed_at,
    marked_finished_at: e.marked_finished_at,
    staff_notes: e.staff_notes,
    staff_notes_updated_at: e.staff_notes_updated_at,
    staff_notes_updated_by: e.staff_notes_updated_by,
    contact: e.contact,
    workflow: { id: e.workflow.id, name: e.workflow.name },
    outcome: { id: e.workflow.outcome.id, name: e.workflow.outcome.name },
    event: {
      id: e.workflow.outcome.event.id,
      title: e.workflow.outcome.event.title,
    },
    assigned_staff: e.assigned_staff,
    stage_label: stage.label,
    total_steps: stage.total,
    steps_done: stage.done,
    days_in_pipeline: daysBetween(e.enrolled_at, nowIso),
    is_unread: !!e.assigned_staff_id && !e.staff_viewed_at,
    form_submission: formSubmission,
    workflow_steps: steps.map((s) => ({
      id: s.id,
      sort_order: s.sort_order,
      step_type: s.step_type,
      config: s.config,
    })),
    step_runs: runs,
    scheduling: scheduling
      ? {
          id: scheduling.id,
          status: scheduling.status,
          duration_minutes: scheduling.duration_minutes,
          message: scheduling.message,
          magic_token: scheduling.magic_token,
          expires_at: scheduling.expires_at,
          scheduled_at: scheduling.scheduled_at,
          cancelled_at: scheduling.cancelled_at,
          created_at: scheduling.created_at,
          slots: scheduling.slots.map((s) => ({
            id: s.id,
            starts_at: s.starts_at,
            ends_at: s.ends_at,
            proposed_by: s.proposed_by,
            is_chosen: s.is_chosen,
          })),
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Per-event CSV export
// ─────────────────────────────────────────────────────────────────
// Unlike the queue, this returns EVERY enrollment for an event —
// active, completed (workflow finished automatically), cancelled,
// and manually marked finished. The CSV is meant to be a complete
// record so staff can work outside the Hub.

export type EventFollowupExportRow = {
  event_title: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_preferred_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  outcome_name: string;
  workflow_name: string;
  status: "active" | "completed" | "cancelled";
  stage_label: string;
  steps_done: number;
  total_steps: number;
  days_in_pipeline: number;
  enrolled_at: string;
  completed_at: string | null;
  marked_finished_at: string | null;
  assigned_staff_name: string | null;
  assigned_staff_email: string | null;
  staff_notes: string | null;
  staff_notes_updated_at: string | null;
  // Every question this person answered on the outcome's sign-up form,
  // keyed by the human label (e.g. "What's your role?" → "Volunteer").
  // The CSV emits one column per unique label seen across the event.
  form_answers: Record<string, string>;
};

export async function getEventFollowupExport(
  supabase: Client,
  eventId: string,
  options: { outcomeId?: string | null } = {}
): Promise<
  | {
      eventTitle: string;
      rows: EventFollowupExportRow[];
      // First-seen-order list of every form question label seen in the
      // event's submissions. Used by the CSV route to emit dynamic
      // columns in a stable, schema-aware order.
      formAnswerColumns: string[];
    }
  | null
> {
  const { data: event } = await supabase
    .from("events")
    .select("id, title")
    .eq("id", eventId)
    .single();
  if (!event) return null;

  const { data: enrollments } = await supabase
    .from("workflow_enrollments")
    .select(
      `
        id, enrolled_at, completed_at, status, current_step, next_run_at,
        marked_finished_at, staff_notes, staff_notes_updated_at, form_submission_id,
        contact:contacts!workflow_enrollments_contact_id_fkey(
          first_name, last_name, preferred_name, email, phone
        ),
        workflow:outcome_workflows!workflow_enrollments_workflow_id_fkey(
          id, name,
          outcome:event_outcomes!outcome_workflows_outcome_id_fkey(
            id, name, event_id
          )
        ),
        assigned_staff:users!workflow_enrollments_assigned_staff_id_fkey(
          first_name, last_name, preferred_name, email
        )
      `
    )
    .order("enrolled_at", { ascending: false })
    .limit(5000);

  type Raw = {
    id: string;
    enrolled_at: string;
    completed_at: string | null;
    status: "active" | "completed" | "cancelled";
    current_step: number;
    next_run_at: string | null;
    marked_finished_at: string | null;
    staff_notes: string | null;
    staff_notes_updated_at: string | null;
    form_submission_id: string | null;
    contact: {
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
    workflow: {
      id: string;
      name: string;
      outcome: {
        id: string;
        name: string;
        event_id: string;
      } | null;
    } | null;
    assigned_staff: {
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
      email: string | null;
    } | null;
  };

  const filtered = ((enrollments ?? []) as Raw[]).filter(
    (r) =>
      r.contact &&
      r.workflow?.outcome?.event_id === eventId &&
      (!options.outcomeId || r.workflow?.outcome?.id === options.outcomeId)
  );

  if (filtered.length === 0) {
    return { eventTitle: event.title, rows: [], formAnswerColumns: [] };
  }

  const workflowIds = Array.from(
    new Set(filtered.map((r) => r.workflow!.id))
  );
  const enrollmentIds = filtered.map((r) => r.id);

  const { data: stepsData } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id, sort_order, step_type, config")
    .in("workflow_id", workflowIds)
    .order("sort_order", { ascending: true });

  const stepsByWorkflow = new Map<string, StepRow[]>();
  for (const s of (stepsData ?? []) as StepRow[]) {
    const arr = stepsByWorkflow.get(s.workflow_id) ?? [];
    arr.push(s);
    stepsByWorkflow.set(s.workflow_id, arr);
  }

  const { data: runsData } = await supabase
    .from("workflow_step_runs")
    .select("enrollment_id, step_id, status, ran_at")
    .in("enrollment_id", enrollmentIds)
    .eq("status", "done")
    .order("ran_at", { ascending: false });

  const latestRunByEnrollment = new Map<string, RunRow>();
  for (const r of (runsData ?? []) as RunRow[]) {
    if (!latestRunByEnrollment.has(r.enrollment_id)) {
      latestRunByEnrollment.set(r.enrollment_id, r);
    }
  }

  // ── Form-submission answers, label-resolved via the form schema ──
  // Every contact got onto this list by submitting an outcome form.
  // For follow-up staff to walk into the first call with full context,
  // every answer the person gave needs to ride along — including
  // dropdowns, multiselects, consent, etc.
  const submissionIds = filtered
    .map((r) => r.form_submission_id)
    .filter((id): id is string => !!id);

  type SubRow = {
    id: string;
    form_id: string | null;
    raw_data: Record<string, unknown> | null;
  };
  const submissionById = new Map<string, SubRow>();
  if (submissionIds.length > 0) {
    const { data: subsData } = await supabase
      .from("form_submissions")
      .select("id, form_id, raw_data")
      .in("id", submissionIds);
    for (const s of ((subsData ?? []) as SubRow[])) {
      submissionById.set(s.id, s);
    }
  }

  const formIds = Array.from(
    new Set(
      Array.from(submissionById.values())
        .map((s) => s.form_id)
        .filter((id): id is string => !!id)
    )
  );
  const fieldsByFormId = new Map<string, FormField[]>();
  if (formIds.length > 0) {
    const { data: formsData } = await supabase
      .from("forms")
      .select("id, schema")
      .in("id", formIds);
    for (const f of ((formsData ?? []) as { id: string; schema: FormSchema | null }[])) {
      const fields: FormField[] = [];
      for (const step of f.schema?.steps ?? []) {
        for (const field of step.fields ?? []) {
          fields.push(field);
        }
      }
      fieldsByFormId.set(f.id, fields);
    }
  }

  // First-seen-order list of unique question labels seen across the
  // event's enrollments. Walking enrollments in the upstream order
  // (newest first) gives a stable, deterministic column order without
  // having to alphabetize.
  const columnOrder: string[] = [];
  const seenColumns = new Set<string>();
  const answersByEnrollmentId = new Map<string, Record<string, string>>();

  for (const r of filtered) {
    const subId = r.form_submission_id;
    const sub = subId ? submissionById.get(subId) : null;
    if (!sub || !sub.raw_data) {
      answersByEnrollmentId.set(r.id, {});
      continue;
    }
    const fields = sub.form_id ? fieldsByFormId.get(sub.form_id) ?? [] : [];
    const answers: Record<string, string> = {};
    // Walk the schema in order so labels accumulate in question order
    // — this is what makes the CSV read naturally.
    for (const field of fields) {
      const key = fieldKey(field);
      const value = sub.raw_data[key];
      const label = field.label || key;
      if (!seenColumns.has(label)) {
        seenColumns.add(label);
        columnOrder.push(label);
      }
      answers[label] = formatFormAnswer(value);
    }
    // Any keys present in raw_data but not described by the schema
    // (legacy fields, deleted questions, contact column writes) still
    // belong in the export — surface them under their raw key.
    for (const [k, v] of Object.entries(sub.raw_data)) {
      if (["_meta", "ip", "user_agent"].includes(k.toLowerCase())) continue;
      const labelFromSchema = fields.find((f) => fieldKey(f) === k)?.label;
      if (labelFromSchema) continue; // already handled above
      const label = k.replaceAll("_", " ");
      if (!seenColumns.has(label)) {
        seenColumns.add(label);
        columnOrder.push(label);
      }
      answers[label] = formatFormAnswer(v);
    }
    answersByEnrollmentId.set(r.id, answers);
  }

  const nowIso = new Date().toISOString();
  const rows: EventFollowupExportRow[] = filtered.map((r) => {
    const steps = stepsByWorkflow.get(r.workflow!.id) ?? [];
    const stage = synthesizeStageLabel({
      status: r.status,
      current_step: r.current_step,
      next_run_at: r.next_run_at,
      steps,
      latestRun: latestRunByEnrollment.get(r.id) ?? null,
      nowIso,
    });

    const staff = r.assigned_staff;
    const staffName = staff
      ? `${staff.first_name || ""} ${staff.last_name || ""}`.trim() ||
        staff.email ||
        null
      : null;

    return {
      event_title: event.title,
      contact_first_name: r.contact!.first_name,
      contact_last_name: r.contact!.last_name,
      contact_preferred_name: r.contact!.preferred_name,
      contact_email: r.contact!.email,
      contact_phone: r.contact!.phone,
      outcome_name: r.workflow!.outcome!.name,
      workflow_name: r.workflow!.name,
      status: r.marked_finished_at ? "completed" : r.status,
      stage_label: r.marked_finished_at
        ? "Marked finished by staff"
        : stage.label,
      steps_done: stage.done,
      total_steps: stage.total,
      days_in_pipeline: daysBetween(r.enrolled_at, nowIso),
      enrolled_at: r.enrolled_at,
      completed_at: r.completed_at,
      marked_finished_at: r.marked_finished_at,
      assigned_staff_name: staffName,
      assigned_staff_email: staff?.email ?? null,
      staff_notes: r.staff_notes,
      staff_notes_updated_at: r.staff_notes_updated_at,
      form_answers: answersByEnrollmentId.get(r.id) ?? {},
    };
  });

  return { eventTitle: event.title, rows, formAnswerColumns: columnOrder };
}

function formatFormAnswer(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => formatFormAnswer(x)).filter(Boolean).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
