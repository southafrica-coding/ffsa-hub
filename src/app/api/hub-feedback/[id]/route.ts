import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getHubFeedbackAccess,
  getHubFeedbackById,
  repointHubFeedbackDuplicates,
  updateHubFeedback,
  type HubFeedbackRow,
} from "@/services/hub-feedback";
import { loadFeedbackDetail } from "@/lib/hub-feedback/server";
import {
  TITLE_MAX,
  isFeedbackKind,
  isFeedbackSeverity,
  isFeedbackStatus,
} from "@/lib/hub-feedback/constants";
import { moduleLabelFor } from "@/lib/hub-feedback/context";

// GET /api/hub-feedback/[id] — one item as the viewer may see it: the
// team gets everything, the submitter their own item minus team notes.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getHubFeedbackAccess(supabase);
  const detail = await loadFeedbackDetail(supabase, createAdminClient(), id, {
    userId: user.id,
    ...access,
  });
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

// PATCH /api/hub-feedback/[id] — triage. Body (all optional):
//   { status, status_note, assigned_to, severity, kind, title, module_id,
//     duplicate_of }
// duplicate_of merges this item into another (status becomes 'duplicate');
// duplicate_of: null with a status un-merges it. RLS also requires triage.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { canTriage } = await getHubFeedbackAccess(supabase);
  if (!canTriage) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: current } = await getHubFeedbackById(supabase, id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const item = current as HubFeedbackRow;

  const patch: Parameters<typeof updateHubFeedback>[2] = {};

  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.trim().slice(0, TITLE_MAX) : "";
    if (!t) return NextResponse.json({ error: "Title can't be empty" }, { status: 400 });
    patch.title = t;
  }
  if ("kind" in body) {
    if (!isFeedbackKind(body.kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    patch.kind = body.kind;
  }
  if ("severity" in body) {
    if (body.severity !== null && !isFeedbackSeverity(body.severity)) {
      return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
    }
    patch.severity = body.severity as string | null;
  }
  if ("module_id" in body) {
    const m = typeof body.module_id === "string" && body.module_id ? body.module_id : null;
    patch.module_id = m;
    patch.module_label = m ? moduleLabelFor(m) : null;
  }
  if ("assigned_to" in body) {
    patch.assigned_to = typeof body.assigned_to === "string" && body.assigned_to ? body.assigned_to : null;
  }
  if ("status_note" in body) {
    patch.status_note =
      typeof body.status_note === "string" && body.status_note.trim()
        ? body.status_note.trim().slice(0, 2000)
        : null;
  }

  if ("duplicate_of" in body && body.duplicate_of) {
    // Merge. Always point at the root, so chains never form.
    const { data: target } = await getHubFeedbackById(supabase, String(body.duplicate_of));
    if (!target) return NextResponse.json({ error: "Item to merge into not found" }, { status: 400 });
    const root = (target as HubFeedbackRow).duplicate_of ?? (target as HubFeedbackRow).id;
    if (root === id) return NextResponse.json({ error: "Can't merge an item into itself" }, { status: 400 });
    patch.duplicate_of = root;
    patch.status = "duplicate";

    // Anything already merged into this item moves to the new root too.
    await repointHubFeedbackDuplicates(createAdminClient(), id, root);
  } else if ("status" in body) {
    if (!isFeedbackStatus(body.status) || body.status === "duplicate") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
    // Leaving 'duplicate' un-merges it.
    if (item.duplicate_of) patch.duplicate_of = null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { data, error } = await updateHubFeedback(supabase, id, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  return NextResponse.json({ success: true });
}
