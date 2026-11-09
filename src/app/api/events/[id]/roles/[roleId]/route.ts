import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEventRole, deleteEventRole } from "@/services/event-roles";
import { getAuthedUser } from "@/lib/api-auth";
import { EVENT_CREATE_GATE, writeBlocked } from "@/lib/auth/event-access";
import { gateChildRow } from "@/lib/auth/event-route";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; roleId: string }> }
) {
  const { id: eventId, roleId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(supabase, user.id, eventId, "event_roles", roleId, EVENT_CREATE_GATE);
  if (denied) return denied;

  let body: {
    role_name?: string;
    notes?: string | null;
    sort_order?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.role_name !== undefined) patch.role_name = body.role_name.trim();
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await updateEventRole(supabase, roleId, patch);
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ role: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; roleId: string }> }
) {
  const { id: eventId, roleId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const denied = await gateChildRow(supabase, user.id, eventId, "event_roles", roleId, EVENT_CREATE_GATE);
  if (denied) return denied;

  const { data, error } = await deleteEventRole(supabase, roleId);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
