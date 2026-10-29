import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomBytes } from "crypto";

const VALID_TYPES = ["staff", "student", "community"] as const;
type SignupType = (typeof VALID_TYPES)[number];

function generateCode(): string {
  // 18 random bytes → 24-char base64url string (no padding).
  return randomBytes(18).toString("base64url");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: superCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!superCheck || superCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const rawType = (body as { type?: string }).type ?? null;
  if (!VALID_TYPES.includes(rawType as SignupType)) {
    return NextResponse.json(
      { error: "type must be one of staff, student, community" },
      { status: 400 }
    );
  }
  const type = rawType as SignupType;

  const newCode = generateCode();
  const adminSupabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminSupabase as any)
    .from("signup_links")
    .update({
      code: newCode,
      regenerated_at: new Date().toISOString(),
      regenerated_by: authUser.id,
    })
    .eq("type", type)
    .select("type, code, enabled, regenerated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "update",
    resource_type: "signup_links",
    resource_id: type,
    changes: { code_rotated: true },
  });

  return NextResponse.json(data);
}
