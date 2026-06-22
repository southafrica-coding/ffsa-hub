import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingOwner,
  insertInspection,
} from "@/services/vehicles";

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

function bool(v: unknown): boolean | null {
  return v === true || v === false ? v : null;
}

// POST /api/vehicles/inspections — record a collection or return inspection.
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookingId = nn(body.vehicle_booking_id);
  const kind = body.kind === "collection" || body.kind === "return" ? body.kind : null;
  if (!bookingId) return NextResponse.json({ error: "vehicle_booking_id is required" }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "kind must be 'collection' or 'return'" }, { status: 400 });

  const access = await getVehicleAccess(supabase, user.id);
  const { data: booking } = await getVehicleBookingOwner(supabase, bookingId);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  if (!isManager && booking.requested_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const damagePanels = Array.isArray(body.damage_panels)
    ? body.damage_panels.filter((p: unknown): p is string => typeof p === "string")
    : [];
  const inventory =
    body.inventory && typeof body.inventory === "object" ? body.inventory : {};

  const { data, error } = await insertInspection(supabase, {
    vehicle_booking_id: bookingId,
    vehicle_id: nn(body.vehicle_id),
    kind,
    driver_names: nn(body.driver_names),
    mileage:
      typeof body.mileage === "number" && body.mileage >= 0 ? body.mileage : null,
    fuel_full: bool(body.fuel_full),
    washed: bool(body.washed),
    damage_reported: bool(body.damage_reported),
    damage_panels: damagePanels,
    inventory,
    condition_notes: nn(body.condition_notes),
    declaration_agreed: body.declaration_agreed === true,
    performed_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inspection: data });
}
