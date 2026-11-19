import { NextResponse } from "next/server";
import { bad, fleetAuth, readJson } from "@/lib/fleet/api";

// POST /api/vehicles/fleet/guide — tick or untick a tutorial step for the signed-in
// person (SPEC 8: tutorial progress is stored per user).
export async function POST(request: Request) {
  const auth = await fleetAuth("view");
  if (!auth.ok) return auth.response;
  const b = await readJson<{ step?: string; done?: boolean }>(request);
  const step = typeof b?.step === "string" ? b.step.trim().slice(0, 100) : "";
  if (!step) return bad("Which step?");
  const q = auth.supabase.from("fleet_guide_progress");
  const { error } = b?.done === false
    ? await q.delete().eq("user_id", auth.user.id).eq("step", step)
    : await q.upsert({ user_id: auth.user.id, step }, { onConflict: "user_id,step" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
