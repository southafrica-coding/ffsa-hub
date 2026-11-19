import { NextResponse, after } from "next/server";
import { bad, dbError, field, legalGate, readJson, withBadField } from "@/lib/legal/api";
import { recentTasksOf, runTask, taskLimitProblem } from "@/lib/legal/helper/tasks";
import { helperIdentity } from "@/lib/legal/helper/who";
import { getLegalHelperTasks } from "@/services/legal-documents";

// The task runs after the reply, inside this request's time limit.
export const maxDuration = 300;

// GET — recent background tasks (RLS: whole-module members).
export async function GET() {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  const { data, error } = await getLegalHelperTasks(gate.supabase);
  if (error) return dbError(error);
  return NextResponse.json({ tasks: data ?? [] });
}

// POST { title, request } — start a background task now (the "work on it
// in the background" button). The helper's own hand-offs come in through
// the chat and are started with .../tasks/[id] {action:"run"}.
export const POST = withBadField(async (request: Request) => {
  const gate = await legalGate();
  if (gate.error) return gate.error;
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "The legal helper isn't set up." }, { status: 503 });
  const body = await readJson(request);
  if (!body) return bad("Expected a JSON body");
  const req = field.text(body.request, "Request", 20000, { required: true }) as string;
  const title = field.text(body.title, "Title", 200) ?? req.slice(0, 80);

  const limit = taskLimitProblem(await recentTasksOf(gate.supabase, gate.userId), Date.now());
  if (limit) return NextResponse.json({ error: limit }, { status: 429 });

  const { data: task, error } = await gate.supabase
    .from("legal_helper_tasks")
    .insert({ title, request: req, created_by: gate.userId })
    .select("id, title, status, created_at")
    .single();
  if (error) return dbError(error);

  const who = await helperIdentity(gate.supabase, gate.userId);
  after(() => runTask({ supabase: gate.supabase, userId: gate.userId, ...who, taskId: task.id }));
  return NextResponse.json({ success: true, task }, { status: 202 });
});
