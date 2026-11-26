import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { kindHasFlipbook, kindLabel } from "@/lib/store/catalogue";
import type { StoreProduct, StoreVariant } from "@/lib/store/types";
import { getProductBySlug, listVariants } from "@/services/store";
import { BuyBox } from "../../_components/buy-box";
import { PreviewFlipbook } from "../../_components/preview-flipbook";
import { CoverImage } from "../../_components/ui";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const supabase = await createClient();
  const { data } = await getProductBySlug(supabase, slug);
  const product = data as StoreProduct | null;
  if (!product || product.status !== "published") return null;
  const { data: variants } = await listVariants(supabase, [product.id]);
  return { product, variants: ((variants ?? []) as StoreVariant[]).filter((v) => v.active) };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const loaded = await load((await params).slug);
  return loaded ? { title: loaded.product.title, description: loaded.product.subtitle ?? undefined } : {};
}

function whatYouGet(p: StoreProduct): string[] {
  const out: string[] = [];
  if (p.kind === "digital") out.push("Read it in your browser, on up to 3 devices", "Opened pages stay readable offline");
  if (p.kind === "subscription") out.push(`Everything we publish for ${p.subscription_months === 12 ? "a year" : `${p.subscription_months} months`}`, "Read in your browser, on up to 3 devices");
  if (p.kind === "bundle") out.push("The printed copy", "The digital edition in your browser", "A low-res PDF");
  if (p.kind === "physical" || p.kind === "bundle") {
    if (p.allow_delivery && p.allow_collect) out.push("Delivered, or collect at the base");
    else if (p.allow_delivery) out.push("Delivered to you");
    else out.push("Collect at the base in Potchefstroom");
  }
  if (p.is_preorder && p.preorder_ships_on) out.push(`Ships from ${new Date(`${p.preorder_ships_on}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}`);
  return out;
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const loaded = await load((await params).slug);
  if (!loaded) notFound();
  const { product, variants } = loaded;
  const cover = <CoverImage src={product.cover_image_url ? `/api/store/cover/${product.id}` : null} title={product.title} className="mx-auto max-w-[420px] border border-ink" />;

  return (
    <article className="md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:gap-10 md:px-8 md:pt-8">
      <div className="border-b border-ink md:border md:border-ink">
        {kindHasFlipbook(product.kind) ? <PreviewFlipbook slug={product.slug} fallback={<div className="p-4 md:p-8">{cover}</div>} /> : <div className="p-4 md:p-8">{cover}</div>}
      </div>

      <div className="px-4 pt-6 md:px-0 md:pt-0">
        <Link href="/store" className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)] hover:text-ink">
          ← Store
        </Link>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="chip">{kindLabel(product.kind)}</span>
          {product.is_preorder && <span className="chip" data-active="true">Preorder</span>}
        </div>
        <h1 className="masthead-title mt-3">{product.title}</h1>
        {product.subtitle && <p className="mt-3 text-[17px] leading-snug text-[color:var(--text-secondary)]">{product.subtitle}</p>}

        <div className="mt-6">
          <BuyBox
            product={{
              id: product.id,
              title: product.title,
              kind: product.kind,
              price_cents: product.price_cents,
              allow_gift: product.allow_gift,
              allow_code_packs: product.allow_code_packs,
              is_preorder: product.is_preorder,
            }}
            variants={variants.map((v) => ({ id: v.id, label: v.label, price_cents: v.price_cents, stock: v.stock }))}
          />
        </div>

        <ul className="mt-8 border-t border-ink">
          {whatYouGet(product).map((line) => (
            <li key={line} className="flex items-start gap-3 border-b border-rule py-3 text-[14px]">
              <span className="mt-[7px] h-[3px] w-3 shrink-0 bg-yellow" />
              {line}
            </li>
          ))}
        </ul>

        {product.description && (
          <div className="mt-8 whitespace-pre-line text-[15px] leading-relaxed text-[color:var(--text-secondary)]">{product.description}</div>
        )}

        {kindHasFlipbook(product.kind) && (
          <p className="mt-8 text-[12px] leading-relaxed text-[color:var(--text-tertiary)]">
            Screenshots can&apos;t be fully prevented, so please don&apos;t share pages.
          </p>
        )}
      </div>
    </article>
  );
}
