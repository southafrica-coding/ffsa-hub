import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess, getVehiclePeople } from "@/services/vehicles";

// GET /api/vehicles/people — the roster behind the renter and driver pickers.
//
// Admin-client read behind a permission check: RLS would otherwise hand a
// non-admin only their own row. Returns names, contact details and licence
// STATUS — never a licence number or a storage path.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.canRequest || access.canApprove || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const people = await getVehiclePeople(createAdminClient());
  return NextResponse.json({ people });
}
