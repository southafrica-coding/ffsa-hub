import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createForm, generateUniqueFormSlug } from "@/services/forms";
import { emptyFormSchema } from "@/lib/forms/schema";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked } from "@/lib/auth/event-access";
import { canManageHubForms } from "@/lib/auth/hub-forms-access";
import { previewWriteRefusal } from "@/lib/preview-writes";
import type { Json, TablesInsert } from "@/types/database";

/** Who can fill a new Hub form. "token" needs per-subject links (F4), so not yet. */
const CREATABLE_ACCESS_MODES = ["public", "logged_in"] as const;

// POST /api/forms — create a Hub form (no event). Starts as a draft.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageHubForms(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Previews share the production database.
  const refusal = previewWriteRefusal();
  if (refusal) {
    return NextResponse.json(
      { ...refusal.body, message: "This preview deployment cannot create forms." },
      { status: refusal.status }
    );
  }

  let body: { name?: unknown; access_mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 200) {
    return NextResponse.json({ error: "name must be 200 characters or fewer" }, { status: 400 });
  }
  const accessMode = body.access_mode ?? "public";
  if (!(CREATABLE_ACCESS_MODES as readonly unknown[]).includes(accessMode)) {
    return NextResponse.json({ error: "access_mode must be public or logged_in" }, { status: 400 });
  }

  const slug = await generateUniqueFormSlug(supabase, name);

  // kind and access_mode are migration 390 columns, not yet in the
  // generated types.
  const insert = {
    slug,
    name,
    event_id: null,
    label_id: null,
    schema: emptyFormSchema() as unknown as Json,
    is_active: false, // a draft until published
    records_attendance: false, // no event to attend
    created_by: user.id,
    kind: "generic",
    access_mode: accessMode,
  } as TablesInsert<"forms">;

  const { data, error } = await createForm(supabase, insert);
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}
