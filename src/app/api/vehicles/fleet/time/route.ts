import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";

const KINDS = ["inspection", "km", "trip", "workshop", "admin"];

// POST /api/vehicles/fleet/time — add minutes to the time tracker (SPEC 6.10), for work
// that isn't saved through another Fleet route (e.g. a modal closed without saving).
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const b = await readJson<{ kind?: string; type?: string; vehicleId?: string; mins?: number }>(request);
  if (!b || !KINDS.includes(String(b.kind))) return bad("Unknown kind of work");
  const mins = Number(b.mins);
  if (!(mins > 0 && mins <= 240)) return bad("Minutes must be between 1 and 240");
  await logTime(auth.supabase, auth.user.id, { kind: b.kind!, type: b.type ?? null, vehicleId: isUuid(b.vehicleId) ? b.vehicleId : null, mins });
  return NextResponse.json({ success: true });
}
