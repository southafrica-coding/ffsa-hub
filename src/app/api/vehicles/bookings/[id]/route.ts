import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingById,
  getOverlappingAssignments,
  updateVehicleBooking,
  deleteVehicleBooking,
  setBookingVehicles,
  setBookingDrivers,
  getLicenceFactsFor,
  markDrivingTestPending,
} from "@/services/vehicles";
import { checkDriverEligibility } from "@/lib/vehicles/licence";
import { notifyVehicleManagers } from "@/lib/email/send-vehicle-request";

type DriverInput = {
  user_id?: string | null;
  id?: string | null;
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
  home_country?: string;
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
  if (body.home_country !== undefined) update.home_country = nn(body.home_country);
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

  let drivers: { id: string; name: string }[] = [];
  if (body.drivers !== undefined) {
    // Managers may always fix the driver list; the requester loses that once
    // the booking is closed. Mirrors canEditDrivers on the booking page.
    const closed = booking.status === "completed" || booking.status === "cancelled";
    if (!isManager && closed) {
      return NextResponse.json(
        { error: "This booking is closed — ask a vehicle manager to update the drivers." },
        { status: 403 }
      );
    }
    const rows = (body.drivers ?? [])
      .map((d) => ({
        id: nn(d.id),
        user_id: typeof d.user_id === "string" && d.user_id ? d.user_id : null,
        name: nn(d.name),
        phone: nn(d.phone),
        has_sa_license: !!d.has_sa_license,
        is_first_time: !!d.is_first_time,
        driving_test_status: d.is_first_time ? "pending" : "not_required",
        licence_expiry_snapshot: null as string | null,
        licence_number_snapshot: null as string | null,
      }))
      .filter((d) => d.name);

    // The same hard block as create. Drivers can be added long after a booking
    // is approved, which would otherwise walk straight past both the request
    // check and the approval check.
    const linkedIds = rows
      .map((d) => d.user_id)
      .filter((v): v is string => !!v);
    const pendingTestUserIds: string[] = [];
    if (linkedIds.length > 0) {
      const returnDate =
        (update.return_date as string | undefined) ?? booking.return_date ?? null;
      const facts = await getLicenceFactsFor(createAdminClient(), linkedIds);
      for (const d of rows) {
        if (!d.user_id) continue;
        const f = facts.get(d.user_id);
        const check = f
          ? checkDriverEligibility(
              {
                licence_expiry_date: f.expiry,
                licence_file_url: f.hasFile ? "on-file" : null,
                base_driving_test_status:
                  f.test as "not_required" | "pending" | "passed" | "failed",
                licence_kind: f.kind,
                licence_no_expiry: f.noExpiry,
              },
              returnDate,
              // Editing the driver list is still the request stage — the
              // driving test is re-checked when the booking is approved.
              "request"
            )
          : ({ ok: false, reason: "no_licence", message: "is not an active Hub user." } as const);
        if (!check.ok) {
          return NextResponse.json(
            { error: `${d.name} cannot be added as a driver — ${check.message}`, reason: check.reason },
            { status: 400 }
          );
        }
        d.licence_expiry_snapshot = f?.expiry ?? null;
        d.licence_number_snapshot = f?.number ?? null;
        const promote = d.is_first_time && f?.test === "not_required";
        d.driving_test_status = promote ? "pending" : (f?.test ?? d.driving_test_status);
        d.is_first_time = d.driving_test_status === "pending";
        if (promote && d.user_id) pendingTestUserIds.push(d.user_id);
      }
    }

    await markDrivingTestPending(createAdminClient(), pendingTestUserIds);

    const { data, error } = await setBookingDrivers(supabase, id, rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    drivers = data.map((d) => ({ id: d.id, name: d.name }));
  }

  // A cancellation frees the vehicle up — the managers need to know.
  if (update.status === "cancelled" && booking.status !== "cancelled") {
    await notifyVehicleManagers({
      event: "cancelled",
      bookingId: id,
      bookingName: (update.booking_name as string) ?? booking.booking_name,
      requesterName: booking.requester_name,
      checkoutDate: effCheckout,
      returnDate: effReturn,
    });
  }

  return NextResponse.json({ ok: true, drivers });
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
