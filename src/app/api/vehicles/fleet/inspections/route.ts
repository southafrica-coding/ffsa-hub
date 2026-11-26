import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { loadFleet } from "@/lib/fleet/load";
import { vehiclePatchToColumns } from "@/lib/fleet/mapping";
import { buildInspection, inspectionToRow, vehiclePatchAfterSave, type LastRef } from "@/lib/fleet/inspection";
import { todayInSA } from "@/lib/fleet/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeIfInspected, refreshRentalAlerts } from "@/lib/vehicles/rental-return";
import {
  deleteFleetDraft,
  deleteFleetInspection,
  insertFleetInspection,
  insertFleetOdometerReading,
  updateFleetVehicleDetails,
} from "@/services/fleet";

/* eslint-disable @typescript-eslint/no-explicit-any */

// POST /api/vehicles/fleet/inspections — save an inspection (the Fleet app's
// saveInspection). Body: {vehicleId, draft}. What is stored and how the vehicle changes
// are the tested functions in src/lib/fleet/inspection.ts; this inserts the inspection,
// updates the vehicle (condition, last*, odometer, status after a post-rental inspection), keeps
// the odometer reading, logs the time and removes the server copy of the draft.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;

  const body = await readJson<{ vehicleId?: unknown; draft?: unknown }>(request);
  const vehicleId = body?.vehicleId;
  if (!isUuid(vehicleId)) return bad("Unknown vehicle");

  const today = todayInSA();
  const { F, vehicleRows } = await loadFleet(auth.supabase, today);
  const v = F.vehicles.find((x) => x.id === vehicleId);
  if (!v) return bad("Unknown vehicle", 404);

  const built = buildInspection(F.checklist, body?.draft, { vehicleId, today });
  if ("error" in built) return bad(built.error);
  const doc = built.doc;

  const { data: ins, error: insErr } = await insertFleetInspection(auth.supabase, inspectionToRow(doc, auth.user.id));
  if (insErr || !ins) return NextResponse.json({ error: insErr?.message || "The inspection didn't save." }, { status: 500 });
  const id: string = ins.id;

  const row = vehicleRows.find((r: any) => r.id === vehicleId);
  const details = row && (Array.isArray(row.details) ? row.details[0] : row.details);
  const lastInspection: LastRef | null = (details && details.last_inspection) || null;
  const patch = vehiclePatchAfterSave(v, lastInspection, doc, id);
  if (Object.keys(patch).length) {
    const { error } = await updateFleetVehicleDetails(auth.supabase, vehicleId, { ...vehiclePatchToColumns(patch), updated_by: auth.user.id });
    if (error) {
      // Don't leave an inspection the vehicle doesn't know about: the draft is still on
      // the device, so saving again starts clean.
      await deleteFleetInspection(auth.supabase, id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // A lower reading is kept in history only (SPEC 6.5): odoPatch above left the odometer.
  await insertFleetOdometerReading(auth.supabase, {
    vehicle_id: vehicleId,
    km: doc.odometer,
    date: doc.date,
    note: null,
    source: doc.type === "post" ? "post-trip" : "inspection",
    source_id: id,
    created_by: auth.user.id,
  });
  await logTime(auth.supabase, auth.user.id, { kind: "inspection", type: doc.type, vehicleId, mins: doc.mins });
  await deleteFleetDraft(auth.supabase, auth.user.id, vehicleId);

  // A post-rental inspection for a booking completes it once every vehicle on it has one
  // (Gideon, 24 Nov 2026), and updates the coordinator's post-rental message either way.
  let bookingCompleted = false;
  if (doc.type === "post" && doc.bookingId) {
    try {
      const admin = createAdminClient();
      const r = await completeIfInspected(admin, doc.bookingId, auth.user.id);
      bookingCompleted = r.ok;
      if (!r.ok) await refreshRentalAlerts(admin, doc.bookingId);
    } catch (err) {
      console.error("[fleet/inspections] booking completion", err);
    }
  }

  return NextResponse.json({ success: true, id, mins: doc.mins, bookingCompleted });
}
