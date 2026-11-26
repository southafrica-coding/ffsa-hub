import { NextResponse } from "next/server";
import { saveVisit } from "@/lib/fleet/save-visit";
import { bad, fleetAuth, isUuid, readJson } from "@/lib/fleet/api";
import { deleteFleetVisit, getFleetVehicle, updateFleetVehicleDetails } from "@/services/fleet";

// PUT /api/vehicles/fleet/visits/[id] — change a visit, or record the outcome of a
// booked one (status booked → done).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown visit");
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  return saveVisit(auth, id, body);
}

// DELETE /api/vehicles/fleet/visits/[id] — "Workshop visit deleted." Clears the vehicle's
// follow-up when it pointed at this visit (as the Fleet app does).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown visit");
  const { data, error } = await deleteFleetVisit(auth.supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return bad("Unknown visit", 404);
  const { data: v } = await getFleetVehicle(auth.supabase, data.vehicle_id);
  const details = v && (Array.isArray(v.details) ? v.details[0] : v.details);
  if (details?.follow_up?.recId === id) {
    const { error: e2 } = await updateFleetVehicleDetails(auth.supabase, data.vehicle_id, { follow_up: null, updated_by: auth.user.id });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, message: "Workshop visit deleted." });
}
