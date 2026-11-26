import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { kindHasFlipbook } from "@/lib/store/catalogue";
import { pageUrl } from "@/lib/store/signing";
import type { StoreAsset, StoreAssetPage, StoreProduct, StoreVariant } from "@/lib/store/types";
import { storeAdminClient } from "@/lib/store/db";
import { getProduct, listAssets, listPages, listVariants } from "@/services/store";
import { storeAdminGuard } from "../../guard";
import { ProductForm } from "../product-form";
import { CoverUpload, PdfUpload, PreviewPicker, VariantsEditor } from "./editors";

export const dynamic = "force-dynamic";

export default async function ProductAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId, canManage } = await storeAdminGuard();
  const { data } = await getProduct(supabase, id);
  const product = data as StoreProduct | null;
  if (!product) notFound();

  const [{ data: variants }, { data: assets }] = await Promise.all([listVariants(supabase, [id]), listAssets(supabase, id)]);
  const active = ((assets ?? []) as StoreAsset[]).find((a) => a.is_active) ?? null;
  const latest = ((assets ?? []) as StoreAsset[])[0] ?? null;
  const { data: pages } = active ? await listPages(supabase, active.id) : { data: [] };
  const { data: me } = await storeAdminClient().auth.admin.getUserById(userId);
  const viewer = me.user?.email ?? "staff";

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Store · ${product.status}`}
        title={product.title}
        actions={
          product.status === "published" ? (
            <Link href={`/store/p/${product.slug}`} className="inline-flex min-h-11 items-center border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] hover:bg-bone-2">View on store</Link>
          ) : undefined
        }
      />
      {canManage ? <ProductForm product={product} /> : <p className="px-5 py-6 md:px-8">You can view the Store but not change it.</p>}

      {canManage && (
        <>
          <SectionBar title="Cover" />
          <CoverUpload productId={id} hasCover={!!product.cover_image_url} />

          {(product.kind === "physical" || product.kind === "bundle") && (
            <>
              <SectionBar title="Sizes and stock" meta="LEAVE EMPTY IF THERE'S ONE SIZE" />
              <VariantsEditor productId={id} variants={(variants ?? []) as StoreVariant[]} />
            </>
          )}

          {kindHasFlipbook(product.kind) && (
            <>
              <SectionBar
                title="PDF and flipbook"
                meta={active ? `${active.page_count} PAGES · LIVE` : latest ? latest.status.toUpperCase() : "NOT UPLOADED"}
              />
              <div className="space-y-4 px-5 py-5 md:px-8">
                <p className="max-w-[640px] text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
                  Upload the final PDF. It&apos;s kept private; the Hub turns each page into a phone-sized image for the flipbook (shown without a watermark). Only the Print + Digital PDF download carries the buyer&apos;s email.
                  Uploading again replaces the flipbook for everyone.
                </p>
                {latest && latest.status === "failed" && (
                  <p className="border-l-2 border-destructive bg-bone px-4 py-3 text-[13px]">Last upload failed: {latest.error}</p>
                )}
                {latest && (latest.status === "awaiting_upload" || latest.status === "uploaded" || latest.status === "rendering") && !latest.is_active && (
                  <p className="flex items-center gap-2 text-[13px]">
                    <StatusPill tone="warn">{latest.status === "awaiting_upload" ? "upload not finished" : latest.status}</StatusPill>
                    {latest.status === "rendering" ? `${latest.page_count} pages so far. ` : ""}If this is stuck, upload again.
                  </p>
                )}
                <PdfUpload productId={id} />
              </div>
              {active && (
                <PreviewPicker
                  assetId={active.id}
                  pages={((pages ?? []) as StoreAssetPage[]).map((p) => ({
                    n: p.page_no,
                    preview: p.is_preview,
                    url: pageUrl({ assetId: active.id, page: p.page_no, viewer }),
                  }))}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
