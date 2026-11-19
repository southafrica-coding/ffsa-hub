import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, readJson } from "@/lib/fleet/api";
import { vehiclePatchToColumns } from "@/lib/fleet/mapping";
import { VSTATUS } from "@/lib/fleet/rules";
import { updateFleetVehicleDetails } from "@/services/fleet";

// Fields the pages may change directly. Derived fields (condition, last*, odometer,
// odoPrev, followUp) change only through their own routes (inspections, km, visits).
const EDITABLE = new Set([
  "name", "make", "model", "profile", "year", "colour", "transmission", "vin", "engineNo", "insurer", "policyNo",
  "tracker", "base", "photo", "status", "statusSince", "licenceExpiry", "serviceKm", "serviceMonths", "inspectionDay",
  "tyres", "where", "watch", "notes", "lastService", "lastB2B", "cardPrinted", "followUp",
]);

// PATCH /api/vehicles/fleet/vehicles/[id] — body {patch: {field: value}} in the Fleet
// app's field names (SPEC section 4). Replaces each given field; nothing else changes.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown vehicle");

  const body = await readJson<{ patch?: Record<string, unknown> }>(request);
  const patch = body?.patch;
  if (!patch || typeof patch !== "object" || !Object.keys(patch).length) return bad("Nothing to change");
  const unknown = Object.keys(patch).filter((k) => !EDITABLE.has(k));
  if (unknown.length) return bad(`Can't change: ${unknown.join(", ")}`);
  // "Mark done" on a follow-up clears it; follow-ups are otherwise set by the visit routes.
  if ("followUp" in patch && patch.followUp !== null) return bad("A follow-up can only be cleared here");
  if ("status" in patch && !VSTATUS.includes(String(patch.status))) return bad("Unknown status");
  if ("watch" in patch && !Array.isArray(patch.watch)) return bad("watch must be a list");
  if ("inspectionDay" in patch && patch.inspectionDay !== null && !(Number(patch.inspectionDay) >= 1 && Number(patch.inspectionDay) <= 7))
    return bad("Inspection day must be 1 (Monday) to 7 (Sunday)");

  const columns = vehiclePatchToColumns(patch);
  columns.updated_by = auth.user.id;
  const { data, error } = await updateFleetVehicleDetails(auth.supabase, id, columns);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, vehicle: data });
}
