import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEventOutcome, deleteEventOutcome } from "@/services/event-outcomes";
import { findOrCreateLabel } from "@/services/labels";
import { getAuthedUser } from "@/lib/api-auth";
import { OUTCOMES_GATE, writeBlocked } from "@/lib/auth/event-access";
import { gateChildRow } from "@/lib/auth/event-route";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; outcomeId: string }> }
) {
  const { id: eventId, outcomeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(
    supabase,
    user.id,
    eventId,
    "event_outcomes",
    outcomeId,
    OUTCOMES_GATE
  );
  if (denied) return denied;

  let body: {
    name?: string;
    description?: string | null;
    label_id?: string | null;
    newLabelName?: string | null;
    form_id?: string | null;
    sort_order?: number;
    is_active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.label_id !== undefined) patch.label_id = body.label_id;
  if (body.form_id !== undefined) patch.form_id = body.form_id;
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  // Optionally create a brand-new label on the fly (parity with creation).
  if (body.newLabelName !== undefined && body.newLabelName?.trim()) {
    const found = await findOrCreateLabel(supabase, {
      slug: slugify(body.newLabelName),
      name: body.newLabelName.trim(),
      createdBy: user.id,
      category: "Event outcomes",
    });
    if (found.error || !found.data) {
      return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
    }
    patch.label_id = found.data.id;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await updateEventOutcome(supabase, outcomeId, patch);
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outcome: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; outcomeId: string }> }
) {
  const { id: eventId, outcomeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(
    supabase,
    user.id,
    eventId,
    "event_outcomes",
    outcomeId,
    OUTCOMES_GATE
  );
  if (denied) return denied;

  const { data, error } = await deleteEventOutcome(supabase, outcomeId);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
