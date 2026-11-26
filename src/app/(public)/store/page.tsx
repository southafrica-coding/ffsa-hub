// /store — the storefront. Products are data: whatever Media publishes in
// /store/admin shows here, in their order.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { kindLabel } from "@/lib/store/catalogue";
import { coverSrcsFor } from "@/lib/store/cover";
import { storeAdminClient } from "@/lib/store/db";
import { formatZar } from "@/lib/store/money";
import type { StoreProduct } from "@/lib/store/types";
import { listPublishedProducts } from "@/services/store";
import { ResendPurchasesForm } from "./_components/email-forms";
import { CoverImage } from "./_components/ui";

export const dynamic = "force-dynamic";

function shipsOn(date: string | null) {
  if (!date) return null;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long" });
}

export default async function StorePage() {
  const supabase = await createClient();
  const { data, error } = await listPublishedProducts(supabase);
  const products = (data ?? []) as StoreProduct[];
  const covers: Record<string, string | null> = error ? {} : await coverSrcsFor(storeAdminClient(), products);
  // The one band: the soonest preorder, if there is one. Never invented.
  const preorder = products.filter((p) => p.is_preorder).sort((a, b) => (a.preorder_ships_on ?? "9").localeCompare(b.preorder_ships_on ?? "9"))[0];

  return (
    <>
      <section className="border-b border-ink px-4 pb-6 pt-8 md:px-8 md:pb-10 md:pt-14">
        <div className="masthead-context">Fire &amp; Fragrance South Africa</div>
        <h1 className="font-display text-[clamp(56px,16vw,148px)] font-black uppercase leading-[0.84] tracking-[-0.015em]">Store</h1>
        <p className="mt-4 max-w-[520px] text-[15px] leading-relaxed text-[color:var(--text-secondary)] md:text-[17px]">
          Reviews you read in your browser, print copies, and merch. Buy for yourself, send one as a gift, or get codes for your group.
        </p>
      </section>

      {preorder && (
        <div className="needs-you">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="needs-you-tag">COMING SOON</span>
            <span className="needs-you-text">
              {preorder.title}
              {shipsOn(preorder.preorder_ships_on) ? `, ships ${shipsOn(preorder.preorder_ships_on)}` : ""}. Preorder now.
            </span>
          </div>
          <Link href={`/store/p/${preorder.slug}`} className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow hover:bg-[var(--ink-bg-hover)]">
            Preorder
          </Link>
        </div>
      )}

      <section className="px-4 pt-8 md:px-8 md:pt-12">
        {error ? (
          <p className="text-[15px] text-[color:var(--text-secondary)]">The Store can&apos;t load right now. Try again in a minute.</p>
        ) : products.length === 0 ? (
          <div className="border border-dashed border-rule-strong px-5 py-12 text-center">
            <p className="font-display text-[32px] font-black uppercase leading-none">Nothing here yet</p>
            <p className="mt-3 text-[14px] text-[color:var(--text-secondary)]">The first things go on sale soon.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-6 md:gap-y-12">
            {products.map((p, i) => (
              <li key={p.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, animationFillMode: "both" }}>
                <Link href={`/store/p/${p.slug}`} className="group block min-w-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink">
                  <CoverImage src={covers[p.id] ?? null} title={p.title} className="border border-ink" />
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="chip">{kindLabel(p.kind)}</span>
                    {p.is_preorder && <span className="chip" data-active="true">Preorder</span>}
                  </div>
                  <h2 className="mt-2 font-display text-[19px] font-black uppercase leading-[0.95] tracking-[0.005em] decoration-yellow decoration-[3px] underline-offset-4 group-hover:underline md:text-[24px]">
                    {p.title}
                  </h2>
                  <p className="numeral mt-1.5 text-[18px] md:text-[20px]">
                    {p.kind === "subscription" ? `${formatZar(p.price_cents)} / year` : formatZar(p.price_cents)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-14 grid gap-8 border-t border-ink px-4 pt-8 md:mt-20 md:grid-cols-2 md:px-8">
        <div>
          <div className="mono-label mb-2">Already bought?</div>
          <h2 className="font-display text-[30px] font-black uppercase leading-[0.92]">Resend my purchases</h2>
          <p className="mt-2 max-w-[400px] text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
            Lost the email? We&apos;ll send everything you&apos;ve bought, with a link that signs you into My Library.
          </p>
        </div>
        <div className="space-y-4">
          <ResendPurchasesForm />
          <p className="text-[13px] text-[color:var(--text-tertiary)]">
            Got a gift or a group code?{" "}
            <Link href="/store/redeem" className="font-semibold text-ink underline decoration-yellow decoration-2 underline-offset-4">
              Redeem it
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
