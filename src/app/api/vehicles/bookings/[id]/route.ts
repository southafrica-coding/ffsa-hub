import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingById,
  getOverlappingAssignments,
  updateVehicleBooking,
  deleteVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
} from "@/services/vehicles";

type DriverInput = {
  name?: string;
  phone?: string;
  has_sa_license?: boolean;
  is_first_time?: boolean;
};

type PatchBody = {
  booking_name?: string;
  point_person?: string;
  purpose?: string;
  purpose_note?: string;
  requester_phone?: string;
  num_people?: number;
  checkout_date?: string;
  return_date?: string;
  notes?: string;
  status?: string; // "cancelled" here; approve/deny/complete via /decision
  // manager-only
  vehicle_ids?: string[];
  pricing_per_day?: number | null;
  total_amount?: number | null;
  currency?: string;
  payment_required?: boolean;
  payment_received?: boolean;
  drivers?: DriverInput[];
};

function nn(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const access = await getVehicleAccess(supabase, user.id);
  const { data: booking } = await getVehicleBookingById(supabase, id);
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isManager = access.isAdmin || access.canApprove || access.canManage;
  const isOwner = booking.requested_by === user.id;
  if (!isManager && !isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  // Fields anyone with edit rights may change.
  if (body.booking_name !== undefined) update.booking_name = nn(body.booking_name);
  if (body.point_person !== undefined) update.point_person = nn(body.point_person);
  if (body.purpose !== undefined) update.purpose = body.purpose;
  if (body.purpose_note !== undefined) update.purpose_note = nn(body.purpose_note);
  if (body.requester_phone !== undefined)
    update.requester_phone = nn(body.requester_phone);
  if (body.num_people !== undefined)
    update.num_people =
      typeof body.num_people === "number" && body.num_people > 0
        ? body.num_people
        : null;
  if (body.notes !== undefined) update.notes = nn(body.notes);
  if (body.checkout_date !== undefined) update.checkout_date = nn(body.checkout_date);
  if (body.return_date !== undefined) update.return_date = nn(body.return_date);
  if (body.status === "cancelled") update.status = "cancelled";

  // Effective window for clash checks (body override, else existing).
  const effCheckout = (update.checkout_date as string) ?? booking.checkout_date;
  const effReturn = (update.return_date as string) ?? booking.return_date;
  if (effReturn < effCheckout) {
    return NextResponse.json(
      { error: "The return date must be on or after the collection date" },
      { status: 400 }
    );
  }

  // Manager-only fields.
  if (isManager) {
    if (body.pricing_per_day !== undefined)
      update.pricing_per_day = body.pricing_per_day;
    if (body.total_amount !== undefined) update.total_amount = body.total_amount;
    if (body.currency !== undefined) update.currency = body.currency;
    if (body.payment_required !== undefined)
      update.payment_required = !!body.payment_required;
    if (body.payment_received !== undefined) {
      update.payment_received = !!body.payment_received;
      update.payment_received_at = body.payment_received
        ? new Date().toISOString()
        : null;
    }
  }

  // Vehicle (re)assignment with overlap hard-block.
  let vehicleIds: string[] | null = null;
  if (body.vehicle_ids !== undefined) {
    if (!isManager) {
      return NextResponse.json(
        { error: "Only approvers can assign vehicles" },
        { status: 403 }
      );
    }
    vehicleIds = (body.vehicle_ids ?? []).filter(
      (v): v is string => typeof v === "string"
    );
    const overlapping = await getOverlappingAssignments(
      supabase,
      effCheckout,
      effReturn,
      id
    );
    const unavailable = new Set(overlapping.map((a) => a.vehicle_id));
    const clash = vehicleIds.filter((vid) => unavailable.has(vid));
    if (clash.length > 0) {
      return NextResponse.json(
        {
          error:
            "One or more of those vehicles is already booked for an overlapping period.",
          clashingVehicleIds: clash,
          blocked: true,
        },
        { status: 409 }
      );
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await updateVehicleBooking(supabase, id, update);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (vehicleIds !== null) {
    await setBookingVehicles(supabase, id, vehicleIds);
  }

  if (body.drivers !== undefined) {
    const drivers = (body.drivers ?? [])
      .map((d) => ({
        name: nn(d.name),
        phone: nn(d.phone),
        has_sa_license: !!d.has_sa_license,
        is_first_time: !!d.is_first_time,
        driving_test_status: d.is_first_time ? "pending" : "not_required",
      }))
      .filter((d) => d.name);
    await setBookingDrivers(supabase, id, drivers as Record<string, unknown>[]);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await deleteVehicleBooking(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
