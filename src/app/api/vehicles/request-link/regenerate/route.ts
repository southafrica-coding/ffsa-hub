import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";

// POST — rotate the public vehicle-request link slug. The old
// /request-vehicle/<slug> link stops working immediately. Manager-gated.

function generateSlug(): string {
  // 18 random bytes → 24-char URL-safe (base64url, no padding) string.
  return randomBytes(18).toString("base64url");
}

export async function POST() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.isAdmin || access.canManage)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("vehicle_request_link_settings")
    .update({
      slug: generateSlug(),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", 1)
    .select("slug, enabled, intro_note, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
