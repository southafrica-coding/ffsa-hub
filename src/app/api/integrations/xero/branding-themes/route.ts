import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { getXeroBrandingThemes } from "@/services/xero";

// GET — each Xero organisation's branding theme names, for the school picker.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }
  const [za, us] = await Promise.all([getXeroBrandingThemes(supabase, "za"), getXeroBrandingThemes(supabase, "us")]);
  return NextResponse.json({ za: za?.map((t) => t.name) ?? null, us: us?.map((t) => t.name) ?? null });
}
