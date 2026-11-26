import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { pageUrl, PREVIEW_VIEWER } from "@/lib/store/signing";
import type { StoreAssetPage } from "@/lib/store/types";
import { getActiveAsset, getProductBySlug, listPages } from "@/services/store";
import { NO_STORE } from "../../_shared";

// GET /api/store/preview/[slug] — signed URLs for a published product's
// preview pages only. Public.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: product } = await getProductBySlug(supabase, slug);
  if (!product || product.status !== "published") return NextResponse.json({ pages: [] }, { headers: NO_STORE });
  const admin = storeAdminClient();
  const { data: asset } = await getActiveAsset(admin, product.id);
  if (!asset || asset.status !== "ready") return NextResponse.json({ pages: [], total: 0 }, { headers: NO_STORE });
  const { data: pages } = await listPages(admin, asset.id, { previewOnly: true });
  return NextResponse.json(
    {
      total: asset.page_count,
      pages: ((pages ?? []) as StoreAssetPage[]).map((p) => ({
        n: p.page_no,
        w: p.width,
        h: p.height,
        url: pageUrl({ assetId: asset.id, page: p.page_no, viewer: PREVIEW_VIEWER }),
      })),
    },
    { headers: NO_STORE }
  );
}
