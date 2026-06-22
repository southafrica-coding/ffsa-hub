import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payfastProvider } from "@/lib/payments/payfast";
import { createScheduledInvoice } from "@/services/xero";
import {
  getVehiclePaymentById,
  getVehicleBookingPaymentInfo,
  markVehiclePaymentPaidIfPending,
  markVehiclePaymentStatusIfPending,
  markBookingPaid,
  updateVehiclePayment,
} from "@/services/vehicles";

// POST /api/integrations/payfast/vehicle-notify
//
// PayFast ITN for a VEHICLE rental payment (separate from the ticketing
// notify so the two never cross). Verifies the ITN, marks the payment
// paid (idempotently), flips the booking's payment gate, and — on the
// first transition to paid — posts an AUTHORISED Xero invoice using the
// vehicle's item code (same mechanism as school billing).
export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = request.headers;
  const sourceIp =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    null;

  let result;
  try {
    result = await payfastProvider.verifyWebhook({ rawBody, headers, sourceIp });
  } catch (e) {
    console.error(
      "[payfast/vehicle-notify] verification failed:",
      e instanceof Error ? e.message : e
    );
    return new NextResponse("ok", { status: 200 });
  }

  const admin = createAdminClient();

  const { data: payment } = await getVehiclePaymentById(admin, result.orderId);
  if (!payment) {
    console.error("[payfast/vehicle-notify] payment not found:", result.orderId);
    return new NextResponse("ok", { status: 200 });
  }

  // Amount-match defence (PayFast posts amount_gross).
  if (
    result.amountCents != null &&
    Math.abs(result.amountCents - payment.amount_cents) > 0
  ) {
    console.error(
      "[payfast/vehicle-notify] amount mismatch for payment",
      payment.id,
      "expected",
      payment.amount_cents,
      "got",
      result.amountCents
    );
    return new NextResponse("ok", { status: 200 });
  }

  if (result.status === "paid") {
    // Idempotent: only flips pending → paid; replays land already-paid.
    const { data: updated } = await markVehiclePaymentPaidIfPending(
      admin,
      payment.id,
      result.providerPaymentId
    );

    if (updated) {
      // Flip the booking's payment gate (keys can now be released).
      await markBookingPaid(admin, payment.vehicle_booking_id);

      // Post to Xero using the vehicle's item code (best-effort).
      try {
        const { data: booking } = await getVehicleBookingPaymentInfo(
          admin,
          payment.vehicle_booking_id
        );
        if (booking?.requester_email) {
          const today = new Date().toISOString().split("T")[0];
          const invoice = await createScheduledInvoice(admin, {
            region: "za",
            studentEmail: booking.requester_email,
            studentName: booking.requester_name ?? booking.booking_name,
            dueDate: today,
            reference: `FFSA-VEH-${payment.id.slice(0, 8)}`,
            lineItems: [
              {
                itemCode: payment.xero_item_code,
                description:
                  payment.description ?? `Vehicle rental — ${booking.booking_name}`,
                amount: payment.amount_cents / 100,
              },
            ],
            autoSend: true,
          });
          if (invoice.success) {
            await updateVehiclePayment(admin, payment.id, {
              xero_invoice_id: invoice.invoiceId,
              xero_invoice_number: invoice.invoiceNumber,
            });
          } else {
            console.error("[payfast/vehicle-notify] Xero invoice failed:", invoice.error);
          }
        }
      } catch (e) {
        console.error(
          "[payfast/vehicle-notify] Xero post errored:",
          e instanceof Error ? e.message : e
        );
      }
    }
  } else if (result.status === "cancelled" || result.status === "failed") {
    await markVehiclePaymentStatusIfPending(admin, payment.id, result.status);
  }

  return new NextResponse("ok", { status: 200 });
}
