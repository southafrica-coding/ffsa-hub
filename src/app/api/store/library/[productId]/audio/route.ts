import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { hashDeviceId } from "@/lib/store/devices";
import { accessFor } from "@/lib/store/entitlements";
import { AUDIO_URL_TTL_SECONDS } from "@/lib/store/upload";
import type { StoreEntitlement } from "@/lib/store/types";
import { getProductAudio, isDeviceActive, listEntitlementsFor } from "@/services/store";
import { bad, NO_STORE } from "../../../_shared";

// GET /api/store/library/[productId]/audio — the flipbook's background
// music, if Media uploaded any: a short-lived signed URL to the PRIVATE
// store-audio bucket. Same fence as the pages: an active entitlement and a
// registered device. { url: null } when there's no music.
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) return bad("Sign in to read", 401);

  const hash = hashDeviceId(request.headers.get("x-store-device") ?? "");
  const admin = storeAdminClient();
  if (!hash || !(await isDeviceActive(admin, buyer.userId, hash)).data) {
    return NextResponse.json({ error: "Register this device first", device: true }, { status: 403, headers: NO_STORE });
  }
  const { data: ents } = await listEntitlementsFor(admin, buyer);
  if (!accessFor((ents ?? []) as StoreEntitlement[], buyer, productId).read) return bad("This isn't in your library", 403);

  const { data: product } = await getProductAudio(admin, productId);
  const path = product?.audio_path as string | null | undefined;
  if (!path) return NextResponse.json({ url: null }, { headers: NO_STORE });
  const { data: signed, error } = await admin.storage.from("store-audio").createSignedUrl(path, AUDIO_URL_TTL_SECONDS);
  if (error || !signed) return NextResponse.json({ url: null }, { headers: NO_STORE });
  return NextResponse.json({ url: signed.signedUrl, expiresIn: AUDIO_URL_TTL_SECONDS }, { headers: NO_STORE });
}
