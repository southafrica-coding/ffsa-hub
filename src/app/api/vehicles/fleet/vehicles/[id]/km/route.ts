import { NextResponse } from "next/server";
import { bad, fleetAuth, isIsoDate, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { vehiclePatchToColumns } from "@/lib/fleet/mapping";
import { kmAlerts, odoPatch, todayInSA } from "@/lib/fleet/rules";
import { insertFleetOdometerReading, updateFleetVehicleDetails } from "@/services/fleet";

// POST /api/vehicles/fleet/vehicles/[id]/km — Log a km reading (SPEC 6.5, acceptance
// test 8). Saves the reading, moves the odometer on (keeping the previous reading as
// odoPrev when it's a week or more older), logs the time, and returns the km warning
// the app shows in its toast.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown vehicle");

  const body = await readJson<{ km?: unknown; date?: unknown; note?: unknown; mins?: unknown }>(request);
  const km = Number(String(body?.km ?? "").replace(/\D/g, ""));
  const today = todayInSA();
  const date = isIsoDate(body?.date) ? body!.date : today;
  if (!(km > 0)) return bad("Enter the odometer reading in km.");
  if (date > today) return bad("The date can't be in the future.");

  const { F } = await loadFleet(auth.supabase, today);
  const v = F.vehicles.find((x) => x.id === id);
  if (!v) return bad("Unknown vehicle", 404);

  const { error: insErr } = await insertFleetOdometerReading(auth.supabase, {
    vehicle_id: id,
    km,
    date,
    note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
    source: "km-log",
    created_by: auth.user.id,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const patch = odoPatch(v, km, date);
  if (Object.keys(patch).length) {
    const { error } = await updateFleetVehicleDetails(auth.supabase, id, { ...vehiclePatchToColumns(patch), updated_by: auth.user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logTime(auth.supabase, auth.user.id, { kind: "km", vehicleId: id, mins: Math.min(15, Number(body?.mins) || 1) });

  const alert = kmAlerts(F, { ...v, ...patch }).find((a) => a.sev !== "info") ?? null;
  return NextResponse.json({
    success: true,
    moved: Object.keys(patch).length > 0,
    message: alert ? `Saved. ${v.name}: ${alert.text}` : "Km reading saved.",
    sev: alert?.sev ?? null,
  });
}
