import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createEventRole } from "@/services/event-roles";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, canManageEvent, EVENT_CREATE_GATE } from "@/lib/auth/event-access";

// POST /api/events/[id]/roles — add a roster entry.
// Body: { roleName, userId? , contactId?, displayName?, notes? }
// At least one of userId / contactId / displayName must be set.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    roleName?: string;
    userId?: string | null;
    contactId?: string | null;
    displayName?: string | null;
    notes?: string | null;
    sortOrder?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.roleName || !body.roleName.trim()) {
    return NextResponse.json({ error: "roleName is required" }, { status: 400 });
  }
  if (!body.userId && !body.contactId && !body.displayName?.trim()) {
    return NextResponse.json(
      { error: "Provide one of: userId, contactId, or displayName" },
      { status: 400 }
    );
  }

  const { data, error } = await createEventRole(supabase, {
    event_id: eventId,
    role_name: body.roleName.trim(),
    user_id: body.userId ?? null,
    contact_id: body.contactId ?? null,
    display_name: body.displayName?.trim() || null,
    notes: body.notes ?? null,
    sort_order: body.sortOrder ?? 0,
  });

  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ role: data });
}
