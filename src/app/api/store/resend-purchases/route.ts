import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { sendStoreEmail } from "@/lib/store/emails";
import { resendPurchases } from "@/lib/store/resend-purchases";
import { makeBuyerSignInLink } from "@/lib/store/sign-in";
import { listPaidOrdersByEmail } from "@/services/store";
import { NO_STORE, readJson } from "../_shared";

// POST /api/store/resend-purchases — public, neutral, rate-limited.
export async function POST(request: Request) {
  const body = (await readJson(request)) as { email?: unknown } | null;
  const admin = storeAdminClient();
  const result = await resendPurchases(
    {
      limiter: getRateLimiter(),
      findPaidOrders: async (email) => {
        const { data } = await listPaidOrdersByEmail(admin, email);
        return (data ?? []).map((o: { reference: string; store_order_items: [] }) => ({ reference: o.reference, items: o.store_order_items ?? [] }));
      },
      makeSignInLink: (email) => makeBuyerSignInLink(email),
      send: sendStoreEmail,
    },
    { email: body?.email, ip: clientIp(request) }
  );
  return NextResponse.json({ ok: true, message: result.message }, { headers: NO_STORE });
}
