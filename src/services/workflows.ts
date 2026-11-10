import type { TablesInsert, TablesUpdate, Json } from "@/types/database";

type WorkflowInsert = TablesInsert<"outcome_workflows">;
type WorkflowUpdate = TablesUpdate<"outcome_workflows">;
type StepInsert = TablesInsert<"workflow_steps">;
type StepUpdate = TablesUpdate<"workflow_steps">;
type EnrollmentInsert = TablesInsert<"workflow_enrollments">;
type EnrollmentUpdate = TablesUpdate<"workflow_enrollments">;
type StepRunInsert = TablesInsert<"workflow_step_runs">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Workflows (read)
// ────────────────────────────────────────────────────────────

export async function getWorkflowsForOutcome(supabase: Client, outcomeId: string) {
  return supabase
    .from("outcome_workflows")
    .select("*, workflow_steps(*)")
    .eq("outcome_id", outcomeId)
    .order("created_at");
}

export async function getWorkflowById(supabase: Client, id: string) {
  return supabase
    .from("outcome_workflows")
    .select("*, workflow_steps(*), event_outcomes(id, name, label_id, event_id)")
    .eq("id", id)
    .maybeSingle();
}

/**
 * Active workflows for a set of outcomes, with their steps. Used by the
 * form-submit enrollment hook to decide who to enroll.
 */
export async function getActiveWorkflowsForOutcomes(
  supabase: Client,
  outcomeIds: string[]
) {
  if (outcomeIds.length === 0) return { data: [], error: null };
  return supabase
    .from("outcome_workflows")
    .select("*, workflow_steps(*)")
    .in("outcome_id", outcomeIds)
    .eq("is_active", true);
}

// Steps ordered for execution.
export async function getWorkflowSteps(supabase: Client, workflowId: string) {
  return supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("sort_order");
}

// Every workflow across all events, with its outcome + event + step count.
// Powers the Communications → Automations hub.
export async function listAllWorkflows(supabase: Client) {
  return supabase
    .from("outcome_workflows")
    .select(
      "id, name, is_active, created_at, event_outcomes(name, event_id, events(title)), workflow_steps(count)"
    )
    .order("created_at", { ascending: false });
}

// ────────────────────────────────────────────────────────────
// Workflows (write)
// ────────────────────────────────────────────────────────────

export async function createWorkflow(supabase: Client, data: WorkflowInsert) {
  return supabase.from("outcome_workflows").insert(data).select().single();
}

export async function updateWorkflow(supabase: Client, id: string, data: WorkflowUpdate) {
  return supabase
    .from("outcome_workflows")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteWorkflow(supabase: Client, id: string) {
  return supabase.from("outcome_workflows").delete().eq("id", id).select("id");
}

// ────────────────────────────────────────────────────────────
// Steps (write)
// ────────────────────────────────────────────────────────────

export async function createStep(supabase: Client, data: StepInsert) {
  return supabase.from("workflow_steps").insert(data).select().single();
}

export async function updateStep(supabase: Client, id: string, data: StepUpdate) {
  return supabase.from("workflow_steps").update(data).eq("id", id).select().single();
}

export async function deleteStep(supabase: Client, id: string) {
  return supabase.from("workflow_steps").delete().eq("id", id);
}

/** Persist a new ordering: array of step ids in their intended order. */
export async function reorderSteps(supabase: Client, orderedIds: string[]) {
  const updates = orderedIds.map((id, index) =>
    supabase.from("workflow_steps").update({ sort_order: index }).eq("id", id)
  );
  return Promise.all(updates);
}

// ────────────────────────────────────────────────────────────
// Enrollments
// ────────────────────────────────────────────────────────────

export async function createEnrollment(supabase: Client, data: EnrollmentInsert) {
  return supabase.from("workflow_enrollments").insert(data).select().single();
}

export async function getActiveEnrollment(
  supabase: Client,
  workflowId: string,
  contactId: string
) {
  return supabase
    .from("workflow_enrollments")
    .select("id, status, current_step")
    .eq("workflow_id", workflowId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .maybeSingle();
}

export async function updateEnrollment(
  supabase: Client,
  id: string,
  data: EnrollmentUpdate
) {
  return supabase
    .from("workflow_enrollments")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

/**
 * Enrollments whose next step is due. Drives the run-workflows cron.
 * Always called with a service-role admin client.
 */
export async function getDueEnrollments(
  supabase: Client,
  nowIso: string,
  limit = 200
) {
  return supabase
    .from("workflow_enrollments")
    .select("*")
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", nowIso)
    .order("next_run_at")
    .limit(limit);
}

/** Cancel all active enrollments for a contact (e.g. on global unsubscribe). */
export async function cancelActiveEnrollmentsForContact(
  supabase: Client,
  contactId: string,
  reason: string
) {
  return supabase
    .from("workflow_enrollments")
    .update({
      status: "cancelled",
      next_run_at: null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("contact_id", contactId)
    .eq("status", "active")
    .select("id, workflow_id");
}

export async function recordStepRun(supabase: Client, data: StepRunInsert) {
  return supabase.from("workflow_step_runs").insert(data);
}

/**
 * Replace a workflow's steps wholesale with an ordered list. Simpler than
 * diffing for the builder's "save" — delete all, re-insert in order.
 */
export async function replaceWorkflowSteps(
  supabase: Client,
  workflowId: string,
  steps: Array<{ step_type: string; config: unknown }>
) {
  await supabase.from("workflow_steps").delete().eq("workflow_id", workflowId);
  if (steps.length === 0) return { data: [], error: null };
  const rows = steps.map((s, i) => ({
    workflow_id: workflowId,
    sort_order: i,
    step_type: s.step_type,
    config: (s.config ?? {}) as Json,
  }));
  return supabase.from("workflow_steps").insert(rows).select();
}
