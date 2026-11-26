import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, logTime, readJson } from "@/lib/fleet/api";
import { fixEntry, isFixable } from "@/lib/fleet/fixes";
import { todayInSA } from "@/lib/fleet/rules";
import type { ConditionEntry } from "@/lib/fleet/rules/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFleetVehicle, insertFleetFix, isMissingFunction, markFleetFixed, removeUnfinishedFleetFix, updateFleetVehicleDetails } from "@/services/fleet";

/* eslint-disable @typescript-eslint/no-explicit-any */

// POST /api/vehicles/fleet/vehicles/[id]/fixed — "Mark as fixed" on a Fix now or Monitor point.
// Body: { itemId, date, by, work }. The point goes back to OK as of `date`, with who fixed
// it and what was done; the next inspection that checks it overrides it as usual. The fix
// itself is kept for good in fleet_fixes (358), for the vehicle's History and its report.
// A 500 says what didn't happen, not the database's own message (Jack's review of #723):
// the detail goes to the server log.
function saveFailed(step: string, e: { message?: string }) {
  console.error(`[fleet] Mark as fixed failed at ${step}:`, e?.message);
  return NextResponse.json({ error: "Couldn’t mark it fixed. Nothing was changed: try again." }, { status: 500 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown vehicle");
  const b = await readJson<{ itemId?: string; date?: string; by?: string; work?: string }>(request);
  const itemId = String(b?.itemId || "");
  if (!itemId || itemId.length > 60) return bad("Unknown point");

  const { data: row, error: getErr } = await getFleetVehicle(auth.supabase, id);
  if (getErr) return saveFailed("read_vehicle", getErr);
  const details: any = row && (Array.isArray(row.details) ? row.details[0] : row.details);
  if (!details) return bad("Unknown vehicle", 404);
  const condition: Record<string, ConditionEntry> = details.condition || {};

  const r = fixEntry(condition[itemId], { itemId, date: String(b?.date || ""), by: String(b?.by || ""), work: String(b?.work || "") }, todayInSA(), auth.user.id);
  if ("error" in r) return bad(r.error, isFixable(condition[itemId]?.s) ? 400 : 409);

  const f = r.entry.f!;
  const point = (condition[itemId]?.t || itemId).slice(0, 200);
  // One transaction (410): the fix and the point are saved together, or neither is.
  const { error: rpcErr } = await markFleetFixed(auth.supabase, {
    vehicleId: id,
    itemId,
    point,
    fixedOn: r.entry.d!,
    by: f.by,
    work: f.work,
    was: f.was,
    entry: r.entry as unknown as Record<string, unknown>,
  });
  if (rpcErr && !isMissingFunction(rpcErr)) return saveFailed("mark_fixed", rpcErr);

  if (rpcErr) {
    // Until 410 is applied: history first, then the point, undoing the fix if the point fails.
    const { data: fix, error: fixErr } = await insertFleetFix(auth.supabase, {
      vehicle_id: id,
      item_id: itemId,
      point,
      fixed_on: r.entry.d!,
      fixed_by: f.by,
      work: f.work,
      was: f.was,
      recorded_by: auth.user.id,
    });
    if (fixErr) return saveFailed("insert_fix", fixErr);
    const { error } = await updateFleetVehicleDetails(auth.supabase, id, { condition: { ...condition, [itemId]: r.entry }, updated_by: auth.user.id });
    if (error) {
      if (fix?.id) {
        const { error: undoErr } = await removeUnfinishedFleetFix(createAdminClient(), fix.id);
        if (undoErr) console.error("[fleet] couldn't remove an unfinished fix", fix.id, undoErr.message);
      }
      return saveFailed("update_condition", error);
    }
  }
  await logTime(auth.supabase, auth.user.id, { kind: "workshop", vehicleId: id, mins: 1 });
  return NextResponse.json({ success: true, message: "Marked as fixed." });
}
