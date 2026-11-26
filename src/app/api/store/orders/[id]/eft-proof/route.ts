import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { getOrder } from "@/services/store";
import { bad, NO_STORE } from "../../../_shared";

const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

// POST /api/store/orders/[id]/eft-proof — the buyer attaches proof of an
// EFT payment to a pending order. The order id (a UUID only the buyer was
// given) is the capability. Media still checks the bank before marking paid.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad("Not found", 404);
  const limit = await getRateLimiter().hit(`store-eft-proof:ip:${clientIp(request)}`, { limit: 10, windowSeconds: 600 });
  if (!limit.allowed) return bad("Too many uploads. Wait a few minutes.", 429);

  const admin = storeAdminClient();
  const { data: order } = await getOrder(admin, id);
  if (!order || order.payment_method !== "eft" || order.status !== "pending") return bad("This order isn't waiting on an EFT", 409);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("Attach your proof of payment");
  const ext = TYPES[file.type];
  if (!ext) return bad("Upload a PDF, JPG or PNG");
  if (file.size > 5 * 1024 * 1024) return bad("That file is over 5 MB");

  const path = `eft/${id}.${ext}`;
  const up = await admin.storage.from("store-source").upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) return bad("We couldn't save that. Try again.", 500);
  await admin.from("store_orders").update({ eft_proof_path: path }).eq("id", id).eq("status", "pending");
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
