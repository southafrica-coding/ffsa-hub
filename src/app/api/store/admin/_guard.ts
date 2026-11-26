// Store staff guard for /api/store/admin/*. 401 signed out, 403 without
// store.manage (or store.view for reads). Buyers are never staff.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStoreStaffLevel } from "@/lib/store/access";

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function requireStoreStaff(
  need: "manage" | "view" = "manage"
): Promise<{ ok: true; supabase: Client; userId: string } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const level = await getStoreStaffLevel(supabase, user.id);
  if (!level || (need === "manage" && level !== "manage")) {
    return { ok: false, response: NextResponse.json({ error: "You need Store access for this" }, { status: 403 }) };
  }
  return { ok: true, supabase, userId: user.id };
}
