import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { payfastProvider } from "@/lib/payments/payfast";
import {
  getVehicleAccess,
  getVehicleBookingPaymentInfo,
  getFirstAssignedVehicleXeroCode,
  insertVehiclePayment,
  updateVehiclePayment,
} from "@/services/vehicles";

function siteBase(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "";
  return `${proto}://${host}`;
}

function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "FFSA", last: "Renter" };
  return { first: parts[0], last: parts.slice(1).join(" ") || parts[0] };
}

// POST /api/vehicles/payments — start a PayFast card payment for a rental.
// Body: { booking_id, amount_cents? }. Returns { redirectUrl }.
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

  const bookingId = (body.booking_id as string | undefined)?.trim();
  if (!bookingId) return NextResponse.json({ error: "booking_id is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: booking } = await getVehicleBookingPaymentInfo(admin, bookingId);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  // Authorize: a manager, or the booking's own requester.
  const access = await getVehicleAccess(supabase, user.id);
  const isManager = access.isAdmin || access.canApprove || access.canManage;
  if (!isManager && booking.requested_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (booking.payment_received) {
    return NextResponse.json({ error: "This booking is already paid." }, { status: 409 });
  }

  // Amount: explicit override, else the booking total. Charged in ZAR cents.
  const amountCents =
    typeof body.amount_cents === "number" && body.amount_cents > 0
      ? Math.round(body.amount_cents)
      : booking.total_amount != null
        ? Math.round(Number(booking.total_amount) * 100)
        : 0;
  if (amountCents <= 0) {
    return NextResponse.json(
      { error: "No amount to charge — set a total on the booking first." },
      { status: 400 }
    );
  }

  // Snapshot the assigned vehicle's Xero item code (per-vehicle, like schools).
  const xeroItemCode = await getFirstAssignedVehicleXeroCode(admin, bookingId);

  const rawDesc = `Vehicle rental — ${booking.booking_name}`;
  const description = rawDesc.length > 100 ? rawDesc.slice(0, 97) + "..." : rawDesc;

  const { data: payment, error: payErr } = await insertVehiclePayment(admin, {
    vehicle_booking_id: bookingId,
    amount_cents: amountCents,
    currency: "ZAR",
    status: "pending",
    payment_provider: "payfast",
    description,
    xero_item_code: xeroItemCode,
    created_by: user.id,
  });
  if (payErr || !payment) {
    return NextResponse.json(
      { error: payErr?.message ?? "Could not create the payment." },
      { status: 500 }
    );
  }

  const base = siteBase(request);
  const { first, last } = splitName(booking.requester_name);
  let checkout;
  try {
    checkout = await payfastProvider.createCheckout({
      orderId: payment.id,
      amountCents,
      currency: "ZAR",
      description,
      buyer: { firstName: first, lastName: last, email: booking.requester_email ?? "" },
      returnUrl: `${base}/bookings/vehicles/${bookingId}?paid=1`,
      cancelUrl: `${base}/bookings/vehicles/${bookingId}`,
      notifyUrl: `${base}/api/integrations/payfast/vehicle-notify`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't start the checkout." },
      { status: 500 }
    );
  }

  await updateVehiclePayment(admin, payment.id, { provider_reference: checkout.reference });

  return NextResponse.json({ redirectUrl: checkout.redirectUrl });
}
