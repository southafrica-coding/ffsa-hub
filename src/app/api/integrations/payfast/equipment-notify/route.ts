import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { payfastProvider } from "@/lib/payments/payfast";
import { createScheduledInvoice } from "@/services/xero";
import {
  getOrderById,
  insertEquipmentEvent,
  markOrderPaymentsPaid,
  markOrderPaymentsStatus,
  moveOrderIfStatus,
  updatePayment,
  type EquipmentOrderFull,
} from "@/services/equipment";
import { sendOrderConfirmed } from "@/lib/equipment/emails";

// POST /api/integrations/payfast/equipment-notify
//
// PayFast ITN for an EQUIPMENT hire (its own route, like vehicle-notify, so
// the flows never cross). One PayFast checkout covers both of an order's
// payments, hire and deposit; m_payment_id is the order id.
//
// Paid: verify, check the amount matches hire + deposit, flip both payments
// pending → paid (idempotent — a replayed ITN changes nothing), move the
// order awaiting_payment → confirmed, then on that first transition email
// the confirmation with the /hire/o/[token] link and post an AUTHORISED Xero
// invoice for the hire (the deposit is held, not income). Always 200.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const headers = request.headers;
  const sourceIp = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? null;

  let result;
  try {
    result = await payfastProvider.verifyWebhook({ rawBody, headers, sourceIp });
  } catch (e) {
    console.error("[payfast/equipment-notify] verification failed:", e instanceof Error ? e.message : e);
    return new NextResponse("ok", { status: 200 });
  }

  const admin = createAdminClient();
  const { data } = await getOrderById(admin, result.orderId);
  const order = data as EquipmentOrderFull | null;
  if (!order) {
    console.error("[payfast/equipment-notify] order not found:", result.orderId);
    return new NextResponse("ok", { status: 200 });
  }

  const charged = order.payments
    .filter((p) => (p.kind === "hire" || p.kind === "deposit") && p.status !== "cancelled" && p.status !== "failed")
    .reduce((s, p) => s + p.amount_cents, 0);
  if (result.amountCents != null && result.amountCents !== charged) {
    console.error("[payfast/equipment-notify] amount mismatch for", order.number, "expected", charged, "got", result.amountCents);
    return new NextResponse("ok", { status: 200 });
  }

  if (result.status === "paid") {
    const { data: flipped } = await markOrderPaymentsPaid(admin, order.id, result.providerPaymentId);
    if (!flipped || flipped.length === 0) return new NextResponse("ok", { status: 200 }); // replay

    const { data: moved } = await moveOrderIfStatus(admin, order.id, ["awaiting_payment", "cancelled"], {
      status: "confirmed",
      hold_expires_at: null,
    });
    if (!moved) {
      console.error("[payfast/equipment-notify] paid order", order.number, "was in status", order.status);
    }
    await insertEquipmentEvent(admin, {
      order_id: order.id,
      kind: "paid",
      detail:
        order.status === "cancelled"
          ? "Paid after the hold had been released. Check the gear is still free."
          : "Paid through PayFast. Order confirmed.",
    });

    // Xero: the hire only, on the item code from Pricing (best-effort).
    let xeroInvoiceNumber: string | null = null;
    const hire = order.payments.find((p) => p.kind === "hire");
    if (hire && hire.xero_item_code) {
      try {
        const invoice = await createScheduledInvoice(admin, {
          region: "za",
          studentEmail: order.customer_email,
          studentName: order.customer_org || order.customer_name,
          dueDate: new Date().toISOString().slice(0, 10),
          reference: order.number,
          lineItems: [
            {
              itemCode: hire.xero_item_code,
              description: `Equipment hire ${order.number}, ${order.starts_on} to ${order.ends_on}`,
              amount: hire.amount_cents / 100,
            },
          ],
          autoSend: true,
        });
        if (invoice.success) {
          xeroInvoiceNumber = invoice.invoiceNumber ?? null;
          await updatePayment(admin, hire.id, {
            xero_invoice_id: invoice.invoiceId ?? null,
            xero_invoice_number: invoice.invoiceNumber ?? null,
          });
        } else {
          console.error("[payfast/equipment-notify] Xero invoice failed:", invoice.error);
        }
      } catch (e) {
        console.error("[payfast/equipment-notify] Xero post errored:", e instanceof Error ? e.message : e);
      }
    } else if (hire) {
      console.warn("[payfast/equipment-notify] no Xero item code set on Pricing; skipped the invoice for", order.number);
    }

    await sendOrderConfirmed({ ...order, status: "confirmed" }, xeroInvoiceNumber);
  } else if (result.status === "cancelled" || result.status === "failed") {
    await markOrderPaymentsStatus(admin, order.id, result.status);
    const { data: moved } = await moveOrderIfStatus(admin, order.id, ["awaiting_payment"], {
      status: "cancelled",
      hold_expires_at: null,
    });
    if (moved) {
      await insertEquipmentEvent(admin, {
        order_id: order.id,
        kind: "payment_" + result.status,
        detail: `PayFast reported the payment ${result.status}. The gear was released.`,
      });
    }
  }

  return new NextResponse("ok", { status: 200 });
}
