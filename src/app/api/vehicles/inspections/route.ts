import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingById,
  getVehicleBookingOwner,
  hasInspection,
  insertInspection,
  type VehicleBookingWithRefs,
} from "@/services/vehicles";
import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";

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

  // One inspection per kind. Without this a double-submit writes two rows and
  // the booking page shows whichever comes back first.
  if (await hasInspection(supabase, bookingId, kind)) {
    return NextResponse.json(
      {
        error: `A ${kind} inspection is already recorded for this booking.`,
      },
      { status: 409 }
    );
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
    all_drivers_present: bool(body.all_drivers_present),
    usage_purpose: nn(body.usage_purpose),
    sa_license_confirmed: bool(body.sa_license_confirmed),
    checkin_date: nn(body.checkin_date),
    communicated_truthfully: bool(body.communicated_truthfully),
    inspection_permission: bool(body.inspection_permission),
    performed_by: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Tell the vehicle managers the form is in. Best-effort — a mail problem
  // must not fail a submission the driver has already completed.
  try {
    const { data: full } = await getVehicleBookingById(supabase, bookingId);
    const b = full as VehicleBookingWithRefs | null;
    if (b) {
      const vehicleLabel = (b.assignments ?? [])
        .map((a) => a.vehicle?.name)
        .filter(Boolean)
        .join(", ");
      await notifyVehicleManagers({
        event: kind === "collection" ? "collected" : "returned",
        bookingId,
        bookingName: b.booking_name,
        requesterName: b.requester_name,
        checkoutDate: b.checkout_date,
        returnDate: b.return_date,
        vehicleLabel: vehicleLabel || null,
      });
    }
  } catch {
    console.error("[vehicles] inspection notification failed");
  }

  return NextResponse.json({ ok: true, inspection: data });
}
