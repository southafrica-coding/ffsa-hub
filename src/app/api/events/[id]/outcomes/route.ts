import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createEventOutcome } from "@/services/event-outcomes";
import { findOrCreateLabel } from "@/services/labels";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, canManageEvent, OUTCOMES_GATE } from "@/lib/auth/event-access";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

// POST /api/events/[id]/outcomes — create an outcome for the event.
// Body: { name, description?, labelId? | newLabelName?, sortOrder? }
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, OUTCOMES_GATE.keys, eventId, OUTCOMES_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string | null;
    labelId?: string | null;
    newLabelName?: string | null;
    sortOrder?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let labelId = body.labelId ?? null;
  if (!labelId && body.newLabelName?.trim()) {
    const found = await findOrCreateLabel(supabase, {
      slug: slugify(body.newLabelName),
      name: body.newLabelName.trim(),
      createdBy: user.id,
      category: "Event outcomes",
    });
    if (found.error || !found.data) {
      return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
    }
    labelId = found.data.id;
  }

  const { data, error } = await createEventOutcome(supabase, {
    event_id: eventId,
    name: body.name.trim(),
    description: body.description ?? null,
    label_id: labelId,
    sort_order: body.sortOrder ?? 0,
  });

  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outcome: data });
}
