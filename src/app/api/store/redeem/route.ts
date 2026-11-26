import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { getBuyer } from "@/lib/store/access";
import { normaliseCode } from "@/lib/store/codes";
import { sendStoreEmail, signInEmail } from "@/lib/store/emails";
import { entitlementShape } from "@/lib/store/entitlements";
import { makeBuyerSignInLink } from "@/lib/store/sign-in";
import type { StoreCode, StoreProduct } from "@/lib/store/types";
import { getCode, getProduct, redeemCode } from "@/services/store";
import { bad, NO_STORE, readJson } from "../_shared";

const schema = z.object({ code: z.string().max(40), email: z.string().trim().toLowerCase().email().max(254).optional() });

// POST /api/store/redeem — claim a gift or redeem a pack code. Public:
// holding the code is the proof. Signed in, it lands on your account;
// signed out, on the email you give, and we send that email a sign-in link.
export async function POST(request: Request) {
  const limit = await getRateLimiter().hit(`store-redeem:ip:${clientIp(request)}`, { limit: 20, windowSeconds: 600 });
  if (!limit.allowed) return bad("Too many tries. Wait a few minutes and try again.", 429);

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return bad("Check the code and your email");
  const code = normaliseCode(parsed.data.code);
  if (!code) return bad("That doesn't look like a code. It's 12 letters and numbers, like ABCD-EFGH-JK23");

  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  const email = buyer?.email ?? parsed.data.email;
  if (!email) return bad("Add your email so we know where to put it");

  const admin = storeAdminClient();
  const { data: row } = await getCode(admin, code);
  const found = row as StoreCode | null;
  if (!found || found.redeemed_at) return bad("That code isn't valid or has already been used", 404);

  const { data: product } = await getProduct(admin, found.product_id);
  if (!product) return bad("That code isn't valid or has already been used", 404);

  const now = new Date();
  const { error } = await redeemCode(admin, {
    codeId: found.id,
    email,
    userId: buyer?.userId ?? null,
    kind: found.kind,
    entitlement: { product_id: found.product_id, ...entitlementShape(product as StoreProduct, now), includes_pdf: found.includes_pdf },
  });
  if (error) {
    if (error.message === "already-redeemed") return bad("That code has just been used", 409);
    return bad("We couldn't redeem that code. Try again.", 500);
  }

  if (!buyer) {
    const link = await makeBuyerSignInLink(email);
    if (link) {
      const mail = signInEmail(link);
      await sendStoreEmail({ to: email, ...mail, category: "store_sign_in" });
    }
  }
  return NextResponse.json(
    { ok: true, title: (product as StoreProduct).title, signedIn: !!buyer, next: buyer ? "/store/library" : null },
    { headers: NO_STORE }
  );
}
