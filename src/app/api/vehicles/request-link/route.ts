import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getOrCreateVehicleRequestLink,
  rotateVehicleRequestLink,
} from "@/services/vehicles";

// The shareable /vr/<token> link admins send to people with no Hub account.
// Vehicle managers only: handing out the token is handing out the form.

async function guard() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canApprove || access.canManage)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { error: null, userId: user.id };
}

// GET — the current link, minting one the first time it's asked for.
export async function GET() {
  const g = await guard();
  if (g.error) return g.error;

  const link = await getOrCreateVehicleRequestLink(createAdminClient(), g.userId);
  if (!link) {
    return NextResponse.json({ error: "Could not create a request link" }, { status: 500 });
  }
  return NextResponse.json({ token: link.token, created_at: link.created_at });
}

// POST — rotate. Every copy of the old URL stops working immediately.
export async function POST() {
  const g = await guard();
  if (g.error) return g.error;

  const link = await rotateVehicleRequestLink(createAdminClient(), g.userId);
  if (!link) {
    return NextResponse.json({ error: "Could not rotate the request link" }, { status: 500 });
  }
  return NextResponse.json({ token: link.token, created_at: link.created_at });
}
