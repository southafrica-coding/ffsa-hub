import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getVehicleAccess,
  getPendingVehicleBookings,
  getRecentVehicleActivity,
} from "@/services/vehicles";

// Pending vehicle requests awaiting approval. For vehicle managers/approvers
// only — canView is near-universal (self_service floor), so we gate on
// canApprove/canManage server-side.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.canApprove || access.canManage)) {
    return NextResponse.json({ requests: [], activity: [] });
  }

  const { data } = await getPendingVehicleBookings(supabase);
  const requests = ((data ?? []) as Array<Record<string, unknown>>).map((b) => ({
    id: b.id as string,
    requesterName: (b.requester_name as string | null) ?? null,
    purpose: (b.purpose as string | null) ?? null,
    purposeNote: (b.purpose_note as string | null) ?? null,
    checkoutDate: (b.checkout_date as string | null) ?? null,
    returnDate: (b.return_date as string | null) ?? null,
  }));

  // Recent fleet movement — the sign-outs, sign-ins and cancellations a
  // manager would otherwise only learn about by email.
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const activity = await getRecentVehicleActivity(createAdminClient(), since);

  return NextResponse.json({ requests, activity });
}
