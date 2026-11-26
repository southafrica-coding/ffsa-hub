import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { sendStoreEmail } from "@/lib/store/emails";
import { sendSignInLink } from "@/lib/store/resend-purchases";
import { makeBuyerSignInLink } from "@/lib/store/sign-in";
import { NO_STORE, readJson } from "../_shared";

// POST /api/store/sign-in — email a one-time sign-in link to a buyer.
// Neutral and rate-limited, like Resend my purchases. Only emails that
// already have a Store order or entitlement get a link (and an auth user).
export async function POST(request: Request) {
  const body = (await readJson(request)) as { email?: unknown } | null;
  const admin = storeAdminClient();
  const result = await sendSignInLink(
    {
      limiter: getRateLimiter(),
      findPaidOrders: async () => [],
      hasAnyPurchase: async (email) => {
        const [orders, ents] = await Promise.all([
          admin.from("store_orders").select("id", { count: "exact", head: true }).eq("buyer_email", email),
          admin.from("store_entitlements").select("id", { count: "exact", head: true }).eq("email", email),
        ]);
        return (orders.count ?? 0) + (ents.count ?? 0) > 0;
      },
      makeSignInLink: (email) => makeBuyerSignInLink(email),
      send: sendStoreEmail,
    },
    { email: body?.email, ip: clientIp(request) }
  );
  return NextResponse.json({ ok: true, message: result.message }, { headers: NO_STORE });
}
