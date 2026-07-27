import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, hasAnyRole } from "@/lib/api-auth";
import { updateOption, deleteOption } from "@/services/list-options";

const ADMIN_ROLES = ["super_admin", "admin"];

async function requireAdmin() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await hasAnyRole(supabase, user.id, ADMIN_ROLES)))
    return { error: "Not authorized", status: 403 as const };
  return { user };
}

// PATCH /api/admin/list-options/[id] — rename, reorder, or (de)activate.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  if (typeof body.sort_order === "number") data.sort_order = body.sort_order;
  if (typeof body.is_active === "boolean") data.is_active = body.is_active;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { error } = await updateOption(admin, id, data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    user_id: gate.user.id,
    action: "update",
    resource_type: "list_options",
    resource_id: id,
    changes: data,
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/list-options/[id] — remove an option. System rows (e.g.
// the 'other' sentinel) are protected; deactivate them instead.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data: row } = await admin
    .from("list_options")
    .select("is_system")
    .eq("id", id)
    .maybeSingle();
  if (row?.is_system) {
    return NextResponse.json(
      { error: "This is a built-in option and can't be deleted. Deactivate it instead." },
      { status: 400 }
    );
  }

  const { error } = await deleteOption(admin, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    user_id: gate.user.id,
    action: "delete",
    resource_type: "list_options",
    resource_id: id,
  });

  return NextResponse.json({ success: true });
}
