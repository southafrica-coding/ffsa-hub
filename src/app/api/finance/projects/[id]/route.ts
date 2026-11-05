import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/services/audit";
import {
  canEditFinanceProjects,
  getFinanceProject,
  linkProblem,
  parseFinanceProjectType,
  updateFinanceProject,
  type FinanceProjectPatch,
} from "@/lib/finance/orgs";

// PATCH /api/finance/projects/[id] { project_type?, notes?, linked_project_id? }
// Finance editors only (is_admin / finance_admin / finance.edit). Name and org
// come from Xero and are not editable here; projects are never deleted.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canEditFinanceProjects(supabase, user.id))) {
    return NextResponse.json(
      { error: "You don't have permission to edit finance projects" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: FinanceProjectPatch = {};

  if ("project_type" in body) {
    const parsed = parseFinanceProjectType(body.project_type);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "Type must be ministry, event, asset or empty" },
        { status: 400 }
      );
    }
    patch.project_type = parsed.value;
  }

  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return NextResponse.json({ error: "Notes must be text" }, { status: 400 });
    }
    patch.notes = (body.notes as string | null)?.trim() || null;
  }

  if ("linked_project_id" in body) {
    if (body.linked_project_id !== null && typeof body.linked_project_id !== "string") {
      return NextResponse.json(
        { error: "linked_project_id must be a project id or null" },
        { status: 400 }
      );
    }
    patch.linked_project_id = (body.linked_project_id as string | null) || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change: only project_type, notes and linked_project_id can be edited" },
      { status: 400 }
    );
  }

  const { data: project, error: readErr } = await getFinanceProject(supabase, id);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (patch.linked_project_id) {
    const { data: linked, error: linkErr } = await getFinanceProject(
      supabase,
      patch.linked_project_id
    );
    if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
    const problem = linkProblem(project, linked);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { data, error } = await updateFinanceProject(supabase, id, patch, user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const before = Object.fromEntries(
    Object.keys(patch).map((k) => [k, (project as Record<string, unknown>)[k] ?? null])
  );
  await createAuditLog(supabase, {
    action: "finance_project.update",
    resource_type: "finance_project",
    resource_id: id,
    changes: { before, after: patch },
  });

  return NextResponse.json({ success: true, project: data });
}
