import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getEquipmentAccess,
  getUnitByTag,
  getUnitRowByTag,
  insertUnitEvent,
  listLocations,
  updateUnit,
  type EquipmentUnit,
  type EquipmentUnitState,
} from "@/services/equipment";
import { changedFields, describeUnitChanges, validateUnitEdit } from "@/lib/equipment/unit-edit";

// PATCH /api/equipment/units/[tag] — the unit page's Edit form. Warehouse or
// rental manager (the same can_operate_equipment() gate RLS puts on
// equipment_units and equipment_events). Only the fields in unit-edit.ts;
// every save that changes something writes one 'edited' history event.
export async function PATCH(request: Request, { params }: { params: Promise<{ tag: string }> }) {
  const { tag: rawTag } = await params;
  const tag = decodeURIComponent(rawTag);
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getEquipmentAccess(supabase, user.id);
  if (!access.canOperate) {
    return NextResponse.json({ error: "Only the warehouse or the rental manager can edit gear." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const result = validateUnitEdit(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const [{ data: row }, { data: state }, { data: locations }] = await Promise.all([
    getUnitRowByTag(supabase, tag),
    getUnitByTag(supabase, tag),
    listLocations(supabase),
  ]);
  if (!row) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  const current = row as EquipmentUnit;

  const locs = (locations ?? []) as { id: string; name: string }[];
  if (result.patch.location_id && !locs.some((l) => l.id === result.patch.location_id)) {
    return NextResponse.json({ error: "That location doesn't exist" }, { status: 400 });
  }

  const changes = changedFields(current, result.patch);
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ success: true, unit: current, changed: 0 });
  }

  // A unit scanned onto an open order is still out there: retire it after check-in.
  if (changes.status === "retired" && (state as EquipmentUnitState | null)?.current_order_id) {
    return NextResponse.json(
      { error: "It's on an open order. Check it in before retiring it." },
      { status: 409 }
    );
  }

  const lines = describeUnitChanges(current, changes, (id) => locs.find((l) => l.id === id)?.name);

  const { data, error } = await updateUnit(supabase, current.id, changes);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: eventError } = await insertUnitEvent(supabase, {
    unit_id: current.id,
    kind: "edited",
    detail: lines.join("; "),
    actor_id: user.id,
  });
  if (eventError) {
    return NextResponse.json(
      { error: `Saved, but the history entry wasn't written: ${eventError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, unit: data, changed: lines.length });
}
