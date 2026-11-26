import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { hashDeviceId } from "@/lib/store/devices";
import { accessFor } from "@/lib/store/entitlements";
import { pageUrl, PAGE_URL_TTL_SECONDS } from "@/lib/store/signing";
import type { StoreAssetPage, StoreEntitlement } from "@/lib/store/types";
import { getActiveAsset, isDeviceActive, listEntitlementsFor, listPages } from "@/services/store";
import { bad, NO_STORE } from "../../../_shared";

// GET /api/store/library/[productId]/pages — the reader's page list: one
// short-lived signed URL per page, stamped for this buyer. Needs an active
// entitlement and a registered device (x-store-device header).
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
  const access = accessFor((ents ?? []) as StoreEntitlement[], buyer, productId);
  if (!access.read) return bad("This isn't in your library", 403);

  const { data: asset } = await getActiveAsset(admin, productId);
  if (!asset || asset.status !== "ready") return bad("This isn't ready to read yet. Check back soon.", 409);
  const { data: pages } = await listPages(admin, asset.id);

  return NextResponse.json(
    {
      pages: ((pages ?? []) as StoreAssetPage[]).map((p) => ({
        n: p.page_no,
        w: p.width,
        h: p.height,
        url: pageUrl({ assetId: asset.id, page: p.page_no, viewer: buyer.email }),
        key: `${asset.id}:${p.page_no}`,
      })),
      pdf: access.pdf,
      expiresIn: PAGE_URL_TTL_SECONDS,
    },
    { headers: NO_STORE }
  );
}
