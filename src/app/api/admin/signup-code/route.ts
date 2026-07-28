import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: superCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .eq("roles.name", "super_admin")
    .limit(1);

  if (!superCheck || superCheck.length === 0) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }

  return { authUser };
}

const VALID_TYPES = ["staff", "student", "community"] as const;
type SignupType = (typeof VALID_TYPES)[number];

function parseType(value: string | null): SignupType | null {
  return VALID_TYPES.includes(value as SignupType) ? (value as SignupType) : null;
}

export async function GET(request: Request) {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  const type = parseType(new URL(request.url).searchParams.get("type"));

  const adminSupabase = createAdminClient();

  if (type) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminSupabase as any)
      .from("signup_links")
      .select("type, code, enabled, regenerated_at")
      .eq("type", type)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // No type → return all three links.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminSupabase as any)
    .from("signup_links")
    .select("type, code, enabled, regenerated_at")
    .order("type");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { enabled, type: rawType } = body as { enabled?: boolean; type?: string };

  const type = parseType(rawType ?? null);
  if (!type) {
    return NextResponse.json(
      { error: "type must be one of staff, student, community" },
      { status: 400 }
    );
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminSupabase as any)
    .from("signup_links")
    .update({ enabled })
    .eq("type", type)
    .select("type, code, enabled, regenerated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
