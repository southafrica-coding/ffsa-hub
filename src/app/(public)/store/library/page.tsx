import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getBuyer } from "@/lib/store/access";
import { kindLabel } from "@/lib/store/catalogue";
import { accessFor } from "@/lib/store/entitlements";
import type { StoreEntitlement, StoreProduct } from "@/lib/store/types";
import { getProductsByIds, linkEntitlementsToUser, linkOrdersToUser, listEntitlementsFor } from "@/services/store";
import { AccountTabs } from "../_components/account-tabs";
import { ResendPurchasesForm, SignInForm } from "../_components/email-forms";
import { CoverImage } from "../_components/ui";

export const metadata: Metadata = { title: "My Library" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);

  if (!buyer) {
    return (
      <div className="grid gap-10 px-4 pt-8 md:grid-cols-2 md:px-8 md:pt-14">
        <div>
          <div className="masthead-context">My Library</div>
          <h1 className="masthead-title">Sign in to read</h1>
          <p className="mt-4 max-w-[420px] text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
            Use the email you bought with. We&apos;ll send a link that signs you in. No password.
          </p>
          <div className="mt-6 max-w-[420px]"><SignInForm /></div>
        </div>
        <div className="border-t border-ink pt-8 md:border-l md:border-t-0 md:pl-10 md:pt-0">
          <div className="mono-label mb-2">Lost track?</div>
          <h2 className="font-display text-[30px] font-black uppercase leading-[0.92]">Resend my purchases</h2>
          <p className="mb-5 mt-2 max-w-[400px] text-[14px] leading-relaxed text-[color:var(--text-secondary)]">One email with everything you&apos;ve bought and a sign-in link.</p>
          <div className="max-w-[420px]"><ResendPurchasesForm /></div>
        </div>
      </div>
    );
  }

  // Gifts and purchases made before this email ever signed in: attach them.
  const admin = storeAdminClient();
  await Promise.all([linkEntitlementsToUser(admin, buyer.email, buyer.userId), linkOrdersToUser(admin, buyer.email, buyer.userId)]);

  const { data: ents } = await listEntitlementsFor(supabase, buyer);
  const entitlements = (ents ?? []) as StoreEntitlement[];
  const ids = [...new Set(entitlements.map((e) => e.product_id))];
  const { data: prods } = ids.length ? await getProductsByIds(admin, ids) : { data: [] };
  const items = ((prods ?? []) as StoreProduct[])
    .map((p) => ({ product: p, access: accessFor(entitlements, buyer, p.id) }))
    .filter((x) => x.access.read || entitlements.some((e) => e.product_id === x.product.id && e.expires_at));

  return (
    <>
      <AccountTabs active="library" email={buyer.email} />
      <div className="px-4 pt-8 md:px-8">
        {items.length === 0 ? (
          <div className="border border-dashed border-rule-strong px-5 py-12 text-center">
            <p className="font-display text-[28px] font-black uppercase leading-none">Nothing to read yet</p>
            <p className="mt-3 text-[14px] text-[color:var(--text-secondary)]">
              Paid by EFT? It appears here once we&apos;ve confirmed the payment. Got a code?{" "}
              <Link href="/store/redeem" className="font-semibold text-ink underline decoration-yellow decoration-2 underline-offset-4">Redeem it</Link>.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-6">
            {items.map(({ product, access }) => (
              <li key={product.id}>
                <Link href={access.read ? `/store/library/${product.id}` : `/store/p/${product.slug}`} className="group block">
                  <CoverImage src={product.cover_image_url ? `/api/store/cover/${product.id}` : null} title={product.title} className="border border-ink" />
                  <span className="chip mt-3">{kindLabel(product.kind)}</span>
                  <h2 className="mt-2 font-display text-[18px] font-black uppercase leading-[0.95] decoration-yellow decoration-[3px] underline-offset-4 group-hover:underline">{product.title}</h2>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
                    {!access.read
                      ? "Ended · renew"
                      : access.expiresAt
                        ? `Until ${new Date(access.expiresAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`
                        : "Read"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
