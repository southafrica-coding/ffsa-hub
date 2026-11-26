import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { accessFor } from "@/lib/store/entitlements";
import type { StoreEntitlement, StoreProduct } from "@/lib/store/types";
import { getProduct, listEntitlementsFor } from "@/services/store";
import { Reader } from "./reader";

export const metadata: Metadata = { title: "Reading", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) notFound();
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) redirect("/store/library");

  const admin = storeAdminClient();
  const [{ data: product }, { data: ents }] = await Promise.all([getProduct(admin, productId), listEntitlementsFor(admin, buyer)]);
  if (!product) notFound();
  const access = accessFor((ents ?? []) as StoreEntitlement[], buyer, productId);
  if (!access.read) redirect(`/store/p/${(product as StoreProduct).slug}`);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 border-b border-ink px-4 pb-3 pt-5 md:px-8 md:pb-4 md:pt-6">
        <div className="min-w-0">
          <Link href="/store/library" className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] hover:text-ink">← My Library</Link>
          <h1 className="mt-2 truncate font-display text-[clamp(26px,6vw,44px)] font-black uppercase leading-[0.92]">{(product as StoreProduct).title}</h1>
          {/* Short and in the first fold on a phone; the full note is under the reader. */}
          <p className="mt-2 text-[12px] leading-snug text-[color:var(--text-secondary)]">Pages carry your email. Screenshots can&apos;t be fully blocked.</p>
        </div>
      </div>
      <Reader productId={productId} />
      <p className="px-4 pt-5 text-[12px] leading-relaxed text-[color:var(--text-tertiary)] md:px-8">
        Pages carry your email ({buyer.email}) as a watermark. Pages you open are kept on this device so you can read offline. Screenshots can&apos;t be fully
        prevented, so please keep what you&apos;ve bought to yourself.
      </p>
    </div>
  );
}
