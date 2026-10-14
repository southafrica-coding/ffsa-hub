import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { getXeroTrackingOptions } from "@/services/xero";
import { XERO_SCHOOLS_TRACKING_CATEGORY } from "@/lib/finance/billing";

// GET — the live "Schools" tracking options in each Xero organisation, for
// the charge editor's picker. Read-only. An organisation that isn't connected
// or can't be read comes back as null rather than failing the whole call.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  const [za, us] = await Promise.all([
    getXeroTrackingOptions(supabase, "za", XERO_SCHOOLS_TRACKING_CATEGORY),
    getXeroTrackingOptions(supabase, "us", XERO_SCHOOLS_TRACKING_CATEGORY),
  ]);
  return NextResponse.json({
    category: XERO_SCHOOLS_TRACKING_CATEGORY,
    za: za?.options ?? null,
    us: us?.options ?? null,
  });
}
