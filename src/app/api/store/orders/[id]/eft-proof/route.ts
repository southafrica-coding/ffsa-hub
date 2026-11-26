import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { storeAdminClient } from "@/lib/store/db";
import { canActOnOrder } from "@/lib/store/signing";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { getOrder } from "@/services/store";
import { bad, NO_STORE } from "../../../_shared";

const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

// POST /api/store/orders/[id]/eft-proof — the buyer attaches proof of an
// EFT payment to a pending order. The order id alone is NOT enough: the
// request needs the signed order token from the thanks link (form field
// `t`), or a signed-in buyer (confirmed email) who placed the order.
// One proof per order: the file goes to a fresh path (never upsert) and the
// order only takes it while eft_proof_path is still empty, so nobody can
// overwrite a proof already given. Media still checks the bank before
// marking paid.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Not found", 404);
  const limit = await getRateLimiter().hit(`store-eft-proof:ip:${clientIp(request)}`, { limit: 10, windowSeconds: 600 });
  if (!limit.allowed) return bad("Too many uploads. Wait a few minutes.", 429);

  const form = await request.formData().catch(() => null);
  const token = form?.get("t");
  const buyer = await getBuyer(await createClient());

  const admin = storeAdminClient();
  const { data: order } = await getOrder(admin, id);
  // Same 404 for "no such order" and "not yours", so ids can't be probed.
  if (!order || !canActOnOrder(order, { token: typeof token === "string" ? token : null, buyer })) return bad("Not found", 404);
  if (order.payment_method !== "eft" || order.status !== "pending") return bad("This order isn't waiting on an EFT", 409);
  if (order.eft_proof_path) return bad("We already have your proof of payment", 409);

  const file = form?.get("file");
  if (!(file instanceof File)) return bad("Attach your proof of payment");
  const ext = TYPES[file.type];
  if (!ext) return bad("Upload a PDF, JPG or PNG");
  if (file.size > 5 * 1024 * 1024) return bad("That file is over 5 MB");

  const path = `eft/${id}/${randomUUID()}.${ext}`;
  const up = await admin.storage.from("store-source").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return bad("We couldn't save that. Try again.", 500);
  const { data: saved } = await admin
    .from("store_orders")
    .update({ eft_proof_path: path })
    .eq("id", id)
    .eq("status", "pending")
    .is("eft_proof_path", null)
    .select("id")
    .maybeSingle();
  if (!saved) {
    // Lost a race with another upload (or the order moved on): keep the first.
    await admin.storage.from("store-source").remove([path]);
    return bad("We already have your proof of payment", 409);
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
