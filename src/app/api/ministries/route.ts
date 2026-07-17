import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Create a ministry. Admin-only.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await callerIsAdmin(supabase, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const slug = slugify(body.slug ? String(body.slug) : name);
  if (!slug)
    return NextResponse.json({ error: "Could not derive a slug from the name" }, { status: 400 });

  // ministries isn't in the generated DB types until they're regenerated;
  // cast (matches the codebase pattern for role_permissions).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data, error } = await admin
    .from("staff_ministries")
    .insert({ name, slug, description: body.description ?? null })
    .select("id, name, slug")
    .single();
  if (error) {
    const msg =
      error.code === "23505"
        ? "A ministry with that name already exists"
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "create",
    resource_type: "ministries",
    resource_id: data.id,
    changes: { name, slug },
  });

  return NextResponse.json({ success: true, ministry: data });
}
