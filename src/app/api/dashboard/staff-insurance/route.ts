import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStaffInsuranceAlerts } from "@/services/insurance-alerts";

// Staff whose health insurance is missing / expired / expiring soon, scoped to
// the viewer: ministry leaders see their ministry's people, the dev team
// (super_admin/admin) sees everyone. getStaffInsuranceAlerts returns [] for
// anyone who is neither — the server-side re-check for this widget.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const alerts = await getStaffInsuranceAlerts(supabase, user.id);
  return NextResponse.json({ alerts });
}
