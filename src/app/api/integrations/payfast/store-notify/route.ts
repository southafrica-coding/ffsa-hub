import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { payfastProvider } from "@/lib/payments/payfast";
import { storePaymentsEnabled } from "@/lib/store/flags";
import { settleAndNotify } from "@/lib/store/fulfil";
import { handleStoreItn } from "@/lib/store/payments";
import { cancelPendingOrder } from "@/services/store";

// POST /api/integrations/payfast/store-notify
//
// PayFast's ITN for Store orders. Same verification as the ticket notify
// route (signature + PayFast postback, in the shared adapter); the ITN is
// the only thing that marks a card order paid. Ignored entirely while
// STORE_PAYMENTS_ENABLED is off. Always acks 200.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const admin = storeAdminClient();
  await handleStoreItn(
    {
      paymentsEnabled: storePaymentsEnabled,
      verify: (body) => payfastProvider.verifyWebhook({ rawBody: body, headers: request.headers, sourceIp: null }),
      loadOrder: async (id) => {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
        const { data } = await admin.from("store_orders").select("id, status, total_cents, payment_method").eq("id", id).maybeSingle();
        return data ?? null;
      },
      settle: (orderId, providerPaymentId) => settleAndNotify(admin, { orderId, providerPaymentId }),
      cancel: async (orderId) => {
        await cancelPendingOrder(admin, orderId);
      },
    },
    rawBody
  );
  return new NextResponse("ok", { status: 200 });
}
