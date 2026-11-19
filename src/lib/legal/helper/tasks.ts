// Legal helper background tasks (migration 375). Server-only: the runner
// and the spending-guard read. The pure state rules the screens use are in
// task-state.ts (re-exported here).
//
// A task runs in its OWN request (POST /api/legal/helper/tasks or
// .../tasks/[id] {action: "run"}), after the reply, via next/server
// after(), AS THE PERSON WHO STARTED IT. So it gets a full time budget,
// RLS applies to every step, and closing the page doesn't stop it.

import { progressFor, runLegalHelper } from "./run";
import type { TaskRow } from "./task-state";
export * from "./task-state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Time a run may use inside one 300 s request, leaving room to save. */
export const TASK_BUDGET_MS = 270_000;

/** This person's tasks from the last 24 hours, for the spending guard. Read as the user. */
export async function recentTasksOf(supabase: Client, userId: string) {
  const { data } = await supabase
    .from("legal_helper_tasks")
    .select("id, status, heartbeat_at, created_at")
    .eq("created_by", userId)
    .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return (data ?? []) as Array<Pick<TaskRow, "id" | "status" | "heartbeat_at" | "created_at">>;
}

/**
 * Claims a queued task and works on it. Safe to call twice: only one call
 * wins the claim (status queued → running in one conditional update).
 */
export async function runTask(args: {
  supabase: Client;
  userId: string;
  userName: string | null;
  isOwner: boolean;
  taskId: string;
}): Promise<void> {
  const { supabase, taskId } = args;
  const now = () => new Date().toISOString();

  const { data: claimed } = await supabase
    .from("legal_helper_tasks")
    .update({ status: "running", started_at: now(), heartbeat_at: now(), progress: "Starting", error: null })
    .eq("id", taskId)
    .eq("status", "queued")
    .select("id, request, attempts")
    .maybeSingle();
  if (!claimed) return; // someone else has it, or it isn't queued
  await supabase.from("legal_helper_tasks").update({ attempts: (claimed.attempts ?? 0) + 1 }).eq("id", taskId);

  try {
    const run = await runLegalHelper({
      supabase,
      userId: args.userId,
      userName: args.userName,
      isOwner: args.isOwner,
      messages: [{ role: "user", content: claimed.request }],
      mode: "task",
      budgetMs: TASK_BUDGET_MS,
      onTurn: async (names) => {
        const { data } = await supabase
          .from("legal_helper_tasks")
          .update({ heartbeat_at: now(), progress: progressFor(names) })
          .eq("id", taskId)
          .select("status")
          .maybeSingle();
        return data?.status === "cancelled";
      },
    });
    console.info(`[legal-helper] task=${taskId} in=${run.inputTokens} out=${run.outputTokens} stopped=${run.stopped ?? "-"}`);
    if (run.stopped === "cancelled") return; // the row already says cancelled
    await supabase
      .from("legal_helper_tasks")
      .update({
        status: run.stopped === "refusal" ? "failed" : "done",
        result: run.answer.slice(0, 20000),
        draft_ids: run.drafts.map((d) => d.id),
        error: run.stopped === "refusal" ? "The helper declined this task." : null,
        progress: null,
        finished_at: now(),
        heartbeat_at: now(),
      })
      .eq("id", taskId)
      .neq("status", "cancelled");
  } catch (e) {
    console.error("[legal-helper] task failed", taskId, e);
    await supabase
      .from("legal_helper_tasks")
      .update({ status: "failed", error: "The task stopped with an error. Run it again.", progress: null, finished_at: now() })
      .eq("id", taskId)
      .neq("status", "cancelled");
  }
}
