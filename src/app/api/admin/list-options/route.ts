import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, hasAnyRole } from "@/lib/api-auth";
import { getAllListOptions, createOption, LIST_KEYS } from "@/services/list-options";

const ADMIN_ROLES = ["super_admin", "admin"];

async function requireAdmin() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await hasAnyRole(supabase, user.id, ADMIN_ROLES)))
    return { error: "Not authorized", status: 403 as const };
  return { user };
}

// GET /api/admin/list-options — every list, grouped by list_key.
export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data, error } = await getAllListOptions(admin);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lists: data });
}

// POST /api/admin/list-options — add an option to a list.
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const list_key = typeof body.list_key === "string" ? body.list_key.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  // Value defaults to the label — fine for the human-string lists; callers may
  // pass an explicit slug (e.g. a department) instead.
  const value =
    typeof body.value === "string" && body.value.trim() ? body.value.trim() : label;

  if (!list_key || !LIST_KEYS.includes(list_key)) {
    return NextResponse.json({ error: "Unknown list" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "Label is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  // Place new options at the end of their list.
  const { data: existing } = await admin
    .from("list_options")
    .select("sort_order")
    .eq("list_key", list_key)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = ((existing?.[0]?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await createOption(admin, {
    list_key,
    value,
    label,
    sort_order: nextOrder,
  });
  if (error) {
    const dup = /duplicate|unique/i.test(error.message ?? "");
    return NextResponse.json(
      { error: dup ? "That option already exists." : error.message },
      { status: dup ? 409 : 500 }
    );
  }

  await admin.from("audit_logs").insert({
    user_id: gate.user.id,
    action: "create",
    resource_type: "list_options",
    resource_id: data?.id,
    changes: { list_key, value, label },
  });

  return NextResponse.json({ option: data });
}
