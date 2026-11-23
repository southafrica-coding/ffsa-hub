import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFormById, updateForm, deleteForm } from "@/services/forms";
import { getAuthedUser } from "@/lib/api-auth";
import { FORMS_GATE, FORMS_READ_GATE, writeBlocked } from "@/lib/auth/event-access";
import { hubFormAccess, MISSIO_PASTOR_FORM_FIELDS, MISSIO_WEEKLY_FEEDBACK_KIND } from "@/lib/auth/hub-forms-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { gateEvent } from "@/lib/auth/event-route";
import { previewWriteRefusal } from "@/lib/preview-writes";
import { validateFormSchema, type FormSchema } from "@/lib/forms/schema";
import type { Json } from "@/types/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Who can fill a Hub form. "token" needs per-subject links (F4), so not yet. */
const SETTABLE_ACCESS_MODES = ["public", "logged_in"] as const;

/**
 * Hub forms (no event) are new with /forms, so they get the preview
 * guard: a preview shares the production database. Event forms keep
 * saving as they always have.
 */
function hubFormPreviewRefusal(form: { event_id?: string | null }) {
  if (form.event_id) return null;
  const refusal = previewWriteRefusal();
  if (!refusal) return null;
  return NextResponse.json(
    { ...refusal.body, message: "This preview deployment cannot change forms." },
    { status: refusal.status }
  );
}

type HubAccess = "manage" | "missio_pastor" | null;

/**
 * Forms with an event use the event gate. Forms with none are admin or
 * comms_admin only (canManageHubForms), with one exception: a Missio
 * pastor may read and edit the questions of the Missio weekly feedback
 * form (kind missio_weekly_feedback), and nothing else. That exception
 * never covers a delete.
 */
async function gateForm(supabase: Client, userId: string, formId: string, action: "read" | "write" | "delete") {
  const { data: form, error } = await getFormById(supabase, formId);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!form) return { error: NextResponse.json({ error: "Form not found" }, { status: 404 }) };
  const eventId = (form.event_id as string | null) ?? null;
  let access: HubAccess = null;
  if (eventId) {
    const denied = await gateEvent(supabase, userId, eventId, action === "read" ? FORMS_READ_GATE : FORMS_GATE);
    if (denied) return { error: denied };
  } else {
    access = await hubFormAccess(supabase, userId, form);
    if (!access || (access === "missio_pastor" && action === "delete")) {
      return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
    }
  }
  return { form, access };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const gated = await gateForm(supabase, user.id, id, "read");
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
  const gated = await gateForm(supabase, user.id, id, "write");
  if ("error" in gated && gated.error) return gated.error;
  const previewRefusal = hubFormPreviewRefusal(gated.form);
  if (previewRefusal) return previewRefusal;

  let body: {
    name?: string;
    schema?: unknown;
    label_id?: string | null;
    records_attendance?: boolean;
    is_active?: boolean;
    redirect_url?: string | null;
    access_mode?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // A Missio pastor (not a Hub forms admin) edits the weekly form's
  // questions and name only. Anything else is refused, not ignored.
  const pastorOnly = gated.access === "missio_pastor";
  if (pastorOnly) {
    const extra = Object.keys(body).filter((key) => !(MISSIO_PASTOR_FORM_FIELDS as readonly string[]).includes(key));
    if (extra.length > 0) {
      return NextResponse.json({ error: "Only the questions and the name can be changed here" }, { status: 403 });
    }
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) {
      return NextResponse.json({ error: "The form needs a name" }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.schema !== undefined) {
    // Scale / counter bounds and route rules are checked before they are
    // stored (validateFormSchema, F1). Routes are only stored here; the
    // runner that acts on them is F3.
    const schema = body.schema as FormSchema | null;
    if (!schema || typeof schema !== "object" || !Array.isArray(schema.steps)) {
      return NextResponse.json({ error: "schema must have steps" }, { status: 400 });
    }
    const problems = validateFormSchema(schema);
    if (Object.keys(problems).length > 0) {
      return NextResponse.json(
        { error: "Some questions need fixing", fieldErrors: problems },
        { status: 400 }
      );
    }
    patch.schema = body.schema as Json;
  }
  if (body.access_mode !== undefined) {
    // Only Hub forms choose who can fill them; event forms stay public.
    if (gated.form.event_id) {
      return NextResponse.json({ error: "Event forms are always public" }, { status: 400 });
    }
    if (!(SETTABLE_ACCESS_MODES as readonly unknown[]).includes(body.access_mode)) {
      return NextResponse.json({ error: "access_mode must be public or logged_in" }, { status: 400 });
    }
    patch.access_mode = body.access_mode;
  }
  if (body.label_id !== undefined) patch.label_id = body.label_id;
  if (body.records_attendance !== undefined)
    patch.records_attendance = body.records_attendance;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.redirect_url !== undefined) patch.redirect_url = body.redirect_url;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  if (pastorOnly) {
    // forms RLS lets only admin / comms_admin update rows (no migration in
    // this change), so the gated pastor save goes through the service role,
    // pinned to this one row and its kind. Only name / schema reach here.
    const { data, error } = await createAdminClient()
      .from("forms")
      .update(patch)
      .eq("id", id)
      .eq("kind", MISSIO_WEEKLY_FEEDBACK_KIND)
      .is("event_id", null)
      .select("id, name, slug, kind, is_active, access_mode, schema")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    return NextResponse.json({ form: data });
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
  const gated = await gateForm(supabase, user.id, id, "delete");
  if ("error" in gated && gated.error) return gated.error;
  const previewRefusal = hubFormPreviewRefusal(gated.form);
  if (previewRefusal) return previewRefusal;

  const { data, error } = await deleteForm(supabase, id);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
