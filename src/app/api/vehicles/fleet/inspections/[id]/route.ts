import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid } from "@/lib/fleet/api";
import { vehiclePatchToColumns } from "@/lib/fleet/mapping";
import { inspectionFromRow, recomputeVehicle } from "@/lib/fleet/inspection";
import { keepFixes } from "@/lib/fleet/fixes";
import { deleteFleetInspection, getFleetInspection, getFleetInspections, getFleetVehicle, updateFleetVehicleDetails } from "@/services/fleet";

/* eslint-disable @typescript-eslint/no-explicit-any */

// DELETE /api/vehicles/fleet/inspections/[id] — delete an inspection and work the
// vehicle's condition, lastInspection, lastCheck and lastMonthly out again from the
// remaining inspections (the Fleet app's delete-insp + recomputeVehicle).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown inspection");

  const { data: row, error: getErr } = await getFleetInspection(auth.supabase, id);
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!row) return bad("Inspection not found. It may have been deleted.", 404);
  const vehicleId: string = row.vehicle_id;

  const { error: delErr } = await deleteFleetInspection(auth.supabase, id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { data: rest, error: listErr } = await getFleetInspections(auth.supabase, { vehicleId });
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  const patch = recomputeVehicle(((rest ?? []) as any[]).filter((r) => r.id !== id).map(inspectionFromRow));
  // Points marked as fixed on the vehicle page aren't in any inspection: keep them.
  const { data: vrow } = await getFleetVehicle(auth.supabase, vehicleId);
  const details: any = vrow && (Array.isArray(vrow.details) ? vrow.details[0] : vrow.details);
  patch.condition = keepFixes(patch.condition as any, details?.condition);
  const { error } = await updateFleetVehicleDetails(auth.supabase, vehicleId, { ...vehiclePatchToColumns(patch), updated_by: auth.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, vehicleId });
}
