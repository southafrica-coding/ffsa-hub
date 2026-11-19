import { NextResponse, after } from "next/server";
import { bad, dbError, isUuid, legalGate, readJson } from "@/lib/legal/api";
import {
  canRerun,
  recentTasksOf,
  runTask,
  runningLimitProblem,
  taskLimitProblem,
  taskState,
  type TaskRow,
} from "@/lib/legal/helper/tasks";
import { helperIdentity } from "@/lib/legal/helper/who";

export const maxDuration = 300;

/**
 * POST { action } on one task:
 *   run    — start a queued task (the chat's hand-offs), or run a stopped,
 *            failed or cancelled one again. Runs after the reply.
 *   cancel — stop it; the runner notices between steps.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad task id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const body = await readJson(request);
  const action = body?.action;

  const { data: task, error } = await gate.supabase
    .from("legal_helper_tasks")
    .select("id, status, heartbeat_at, created_at, created_by")
    .eq("id", id)
    .single();
  if (error) return dbError(error);
  const state = taskState(task as TaskRow, Date.now());

  if (action === "cancel") {
    if (!["queued", "running"].includes(task.status)) return bad("This task isn't running");
    const { error: e } = await gate.supabase
      .from("legal_helper_tasks")
      .update({ status: "cancelled", progress: null, finished_at: new Date().toISOString() })
      .eq("id", id);
    if (e) return dbError(e);
    return NextResponse.json({ success: true });
  }

  if (action === "run") {
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The legal helper isn't set up." }, { status: 503 });
    if (task.status !== "queued" && !canRerun(state)) return bad("This task is already working or done");
    // A fresh hand-off was counted when it was created: it only needs a
    // free slot to run. Running a task again counts like a new one.
    const others = (await recentTasksOf(gate.supabase, gate.userId)).filter((t) => t.id !== id);
    const limit =
      task.status === "queued" ? runningLimitProblem(others, Date.now()) : taskLimitProblem(others, Date.now());
    if (limit) return NextResponse.json({ error: limit }, { status: 429 });
    if (task.status !== "queued") {
      const { error: e } = await gate.supabase
        .from("legal_helper_tasks")
        .update({ status: "queued", progress: null, error: null, finished_at: null, heartbeat_at: null })
        .eq("id", id);
      if (e) return dbError(e);
    }
    const who = await helperIdentity(gate.supabase, gate.userId);
    after(() => runTask({ supabase: gate.supabase, userId: gate.userId, ...who, taskId: id }));
    return NextResponse.json({ success: true }, { status: 202 });
  }

  return bad("action must be run or cancel");
}

// DELETE — remove a finished task from the list (its drafts stay).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return bad("Bad task id");
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const { data, error } = await gate.supabase.from("legal_helper_tasks").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "Not found, or not yours to remove" }, { status: 404 });
  return NextResponse.json({ success: true });
}
