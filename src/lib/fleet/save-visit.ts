// Saving a workshop visit: the route-handler side of saveRecord in the Fleet app.
// Validation and the vehicle change are the tested rules in rules/visits.ts.

import { NextResponse } from "next/server";
import { getFleetVisits, insertFleetVisit, updateFleetVehicleDetails, updateFleetVisit } from "@/services/fleet";
import { isIsoDate, isUuid, logTime, type FleetAuth } from "./api";
import { loadFleet } from "./load";
import { vehiclePatchToColumns, visitFromRow } from "./mapping";
import { RECORD_KINDS, todayInSA, visitClashes, visitClashText, visitError, visitUntil, visitVehiclePatch, type VisitInput } from "./rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const kmOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\D/g, ""));
  return n > 0 ? n : null;
};
const moneyOrNull = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  let s = String(v).replace(/[\s R]/g, "");
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
};

export async function saveVisit(auth: Extract<FleetAuth, { ok: true }>, id: string | null, b: Record<string, any>) {
  const vehicleId = b.vehicleId;
  if (!isUuid(vehicleId)) return NextResponse.json({ error: "Choose the vehicle." }, { status: 400 });
  const status = b.status === "booked" ? "booked" : "done";
  const kind = str(b.kind, 100);
  if (!RECORD_KINDS.includes(kind)) return NextResponse.json({ error: "Choose what kind of visit it is." }, { status: 400 });
  const date = isIsoDate(b.date) ? b.date : "";
  const odometer = status === "done" ? kmOrNull(b.odometer) : null;

  const input: VisitInput = {
    id: id || "new",
    status,
    kind,
    date,
    until: status === "booked" && isIsoDate(b.until) ? b.until : "",
    provider: str(b.provider, 200),
    odometer,
    nextDate: status === "done" && isIsoDate(b.nextDate) ? b.nextDate : "",
    nextKm: status === "done" ? kmOrNull(b.nextKm) : null,
    updateLastService: !!b.updateLastService,
    disc: isIsoDate(b.disc) ? b.disc : "",
  };
  const err = visitError(input);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const today = todayInSA();
  const { F } = await loadFleet(auth.supabase, today);
  const v = F.vehicles.find((x) => x.id === vehicleId);
  if (!v) return NextResponse.json({ error: "Unknown vehicle" }, { status: 404 });

  let previous: { status: "booked" | "done" } | null = null;
  if (id) {
    const { data } = await getFleetVisits(auth.supabase, { vehicleId });
    const row = (data ?? []).find((r: any) => r.id === id);
    if (!row) return NextResponse.json({ error: "Unknown visit" }, { status: 404 });
    previous = { status: visitFromRow(row).status };
  }

  // A booked visit that clashes with a trip is saved only when the user confirmed.
  const hits = visitClashes(F, vehicleId, input);
  if (hits.length && !b.force) return NextResponse.json({ clash: visitClashText(hits) }, { status: 409 });

  const work = status === "done" && Array.isArray(b.work)
    ? b.work
        .map((w: any) => ({ d: str(w?.d, 500), cost: moneyOrNull(w?.cost), chk: ["ok", "bad", "na"].includes(w?.chk) ? w.chk : "" /* not checked yet */ }))
        .filter((w: any) => w.d)
    : Array.isArray(b.work) ? b.work : [];
  let cost = status === "done" ? moneyOrNull(b.cost) : null;
  if (cost === null && work.some((w: any) => w.cost !== null && w.cost !== undefined)) cost = work.reduce((s: number, w: any) => s + (Number(w.cost) || 0), 0);
  const files = Array.isArray(b.files)
    ? b.files.filter((f: any) => f && /^[0-9a-f]{32}$/.test(String(f.id))).map((f: any) => ({ id: f.id, name: str(f.name, 200), type: str(f.type, 100) }))
    : [];

  const row = {
    vehicle_id: vehicleId,
    status,
    kind,
    date,
    until: visitUntil(input) || null,
    provider: input.provider || null,
    odometer_km: odometer,
    cost,
    ref: str(b.ref, 200) || null,
    description: str(b.description, 4000) || null,
    work,
    warranty_until: status === "done" && isIsoDate(b.warrantyUntil) ? b.warrantyUntil : null,
    checked_by: status === "done" ? str(b.checkedBy, 200) || null : null,
    files,
    next_date: input.nextDate || null,
    next_km: input.nextKm ?? null,
  };
  const saved = id ? await updateFleetVisit(auth.supabase, id, row) : await insertFleetVisit(auth.supabase, { ...row, created_by: auth.user.id });
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });

  const patch = visitVehiclePatch(v, { ...input, id: saved.data.id }, today, previous);
  if (Object.keys(patch).length) {
    const { error } = await updateFleetVehicleDetails(auth.supabase, vehicleId, { ...vehiclePatchToColumns(patch), updated_by: auth.user.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logTime(auth.supabase, auth.user.id, { kind: "workshop", vehicleId, mins: Math.min(15, Number(b.mins) || 1) });
  return NextResponse.json({ success: true, visit: saved.data, message: status === "booked" ? "Workshop booking saved." : "Workshop visit saved." });
}
