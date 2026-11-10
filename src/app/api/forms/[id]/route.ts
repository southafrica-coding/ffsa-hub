import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFormById, updateForm, deleteForm } from "@/services/forms";
import { getAuthedUser } from "@/lib/api-auth";
import {
  FORMS_GATE,
  FORMS_READ_GATE,
  isUnscopedAdmin,
  hasUnscopedRole,
  loadEventAccess,
  writeBlocked,
} from "@/lib/auth/event-access";
import { gateEvent } from "@/lib/auth/event-route";
import type { Json } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Forms with an event use the event gate. Forms with none are admin or comms_admin only. */
async function gateForm(supabase: Client, userId: string, formId: string, write: boolean) {
  const { data: form, error } = await getFormById(supabase, formId);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!form) return { error: NextResponse.json({ error: "Form not found" }, { status: 404 }) };
  const eventId = (form.event_id as string | null) ?? null;
  if (eventId) {
    const denied = await gateEvent(supabase, userId, eventId, write ? FORMS_GATE : FORMS_READ_GATE);
    if (denied) return { error: denied };
  } else {
    const snap = await loadEventAccess(supabase, userId);
    if (!isUnscopedAdmin(snap) && !hasUnscopedRole(snap, ["comms_admin"])) {
      return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
    }
  }
  return { form };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const gated = await gateForm(supabase, user.id, id, false);
  if ("error" in gated && gated.error) return gated.error;
  return NextResponse.json({ form: gated.form });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const gated = await gateForm(supabase, user.id, id, true);
  if ("error" in gated && gated.error) return gated.error;

  let body: {
    name?: string;
    schema?: unknown;
    label_id?: string | null;
    records_attendance?: boolean;
    is_active?: boolean;
    redirect_url?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.schema !== undefined) patch.schema = body.schema as Json;
  if (body.label_id !== undefined) patch.label_id = body.label_id;
  if (body.records_attendance !== undefined)
    patch.records_attendance = body.records_attendance;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.redirect_url !== undefined) patch.redirect_url = body.redirect_url;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await updateForm(supabase, id, patch);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const gated = await gateForm(supabase, user.id, id, true);
  if ("error" in gated && gated.error) return gated.error;

  const { data, error } = await deleteForm(supabase, id);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
