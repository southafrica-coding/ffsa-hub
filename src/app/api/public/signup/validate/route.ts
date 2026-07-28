import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Lightweight code check used by /join/[code] before showing the form.
// Returns { valid, type } — the resolved signup link type when valid.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminSupabase as any)
    .from("signup_links")
    .select("type, enabled")
    .eq("code", code)
    .maybeSingle();

  const valid = !!data && data.enabled === true;
  return NextResponse.json({ valid, type: valid ? data.type : null });
}
