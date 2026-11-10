import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, OUTCOMES_GATE } from "@/lib/auth/event-access";
import { gateChildRow } from "@/lib/auth/event-route";
import {
  getWorkflowsForOutcome,
  createWorkflow,
  replaceWorkflowSteps,
} from "@/services/workflows";
import type { Json } from "@/types/database";

const STEP_TYPES = ["send_email", "delay", "assign_label"];
const TRIGGER_TYPES = ["on_submit", "answer", "label_added"];

type IncomingStep = { step_type: string; config: unknown };

function validSteps(steps: unknown): steps is IncomingStep[] {
  return (
    Array.isArray(steps) &&
    steps.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        STEP_TYPES.includes((s as { step_type?: string }).step_type ?? "")
    )
  );
}

function validTrigger(trigger: unknown): boolean {
  if (!trigger || typeof trigger !== "object") return false;
  const t = (trigger as { type?: string }).type;
  return typeof t === "string" && TRIGGER_TYPES.includes(t);
}

// GET /api/events/[id]/outcomes/[outcomeId]/workflows — list workflows + steps.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; outcomeId: string }> }
) {
  const { id: eventId, outcomeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(supabase, user.id, eventId, "event_outcomes", outcomeId, OUTCOMES_GATE);
  if (denied) return denied;

  const { data, error } = await getWorkflowsForOutcome(supabase, outcomeId);
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ workflows: data ?? [] });
}

// POST /api/events/[id]/outcomes/[outcomeId]/workflows — create a workflow.
// Body: { name, trigger, is_active?, steps?: [{ step_type, config }] }
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; outcomeId: string }> }
) {
  const { id: eventId, outcomeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(supabase, user.id, eventId, "event_outcomes", outcomeId, OUTCOMES_GATE);
  if (denied) return denied;

  let body: {
    name?: string;
    trigger?: unknown;
    is_active?: boolean;
    steps?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const trigger = validTrigger(body.trigger) ? body.trigger : { type: "on_submit" };

  const { data: workflow, error } = await createWorkflow(supabase, {
    outcome_id: outcomeId,
    name: body.name.trim(),
    trigger: trigger as Json,
    is_active: body.is_active ?? true,
    created_by: user.id,
  });
  if (error || !workflow) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create workflow" },
      { status: 500 }
    );
  }

  if (validSteps(body.steps)) {
    const r = await replaceWorkflowSteps(supabase, workflow.id, body.steps);
    if (r.error) {
      return NextResponse.json(
        { workflow, warning: `Workflow created but steps failed: ${r.error.message}` },
        { status: 207 }
      );
    }
  }

  return NextResponse.json({ workflow });
}
