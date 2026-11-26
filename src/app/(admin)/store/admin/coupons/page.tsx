import Link from "next/link";
import { redirect } from "next/navigation";
import { Masthead, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { describeDiscount, type StoreCoupon } from "@/lib/store/coupons";
import type { StoreProduct } from "@/lib/store/types";
import { listAllProducts, listCoupons } from "@/services/store";
import { storeAdminGuard } from "../guard";
import { CouponToggle } from "./coupon-toggle";

export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

function usage(c: StoreCoupon): string {
  return c.max_uses != null ? `${c.used_count} of ${c.max_uses} used` : `${c.used_count} used · no limit`;
}

function state(c: StoreCoupon, now: number): { tone: "good" | "warn" | "quiet"; label: string } {
  if (!c.active) return { tone: "quiet", label: "Off" };
  if (c.expires_at && new Date(c.expires_at).getTime() <= now) return { tone: "quiet", label: "Expired" };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { tone: "warn", label: "Used up" };
  return { tone: "good", label: "On" };
}

// /store/admin/coupons — store.manage only. View-only staff go back to the
// Store admin; the write APIs refuse them too.
export default async function StoreCouponsPage() {
  const { supabase, canManage } = await storeAdminGuard();
  if (!canManage) redirect("/store/admin");
  const [{ data: couponRows, error }, { data: productRows }] = await Promise.all([listCoupons(supabase), listAllProducts(supabase)]);
  const coupons = (couponRows ?? []) as StoreCoupon[];
  const products = new Map(((productRows ?? []) as StoreProduct[]).map((p) => [p.id, p.title]));
  const scope = (c: StoreCoupon) => (c.product_id ? (products.get(c.product_id) ?? "One product") : "All products");
  const now = Date.now();

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Media · Store"
        title="Coupons"
        actions={
          <>
            <Link href="/store/admin" className="inline-flex min-h-11 items-center border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone-2">Store admin</Link>
            <MastheadAction href="/store/admin/coupons/new">New coupon</MastheadAction>
          </>
        }
      />

      {error && (
        <p className="border-b border-rule bg-bone px-5 py-3 text-[13px] md:px-8">
          The coupon tables didn&apos;t load. Migration 413 may not be applied to this database yet.
        </p>
      )}

      <SectionBar title="Codes" meta={`${coupons.length}`} />
      {coupons.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-[color:var(--text-secondary)] md:px-8">No coupons yet. Make the first one with New coupon.</p>
      ) : (
        <>
          {/* Phones: one card per code. The table is md and up. */}
          <ul className="md:hidden">
            {coupons.map((c) => {
              const s = state(c, now);
              return (
                <li key={c.id} className="border-b border-rule px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/store/admin/coupons/${c.id}`} className="min-w-0 break-all font-mono text-[15px] font-bold leading-snug hover:underline">
                      {c.code}
                    </Link>
                    <span className="shrink-0 font-semibold">{describeDiscount(c)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-[color:var(--text-secondary)]">{scope(c)}</p>
                  {c.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-[color:var(--text-tertiary)]">{c.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--text-secondary)]">
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                    <span>{usage(c)}</span>
                    <span>{c.expires_at ? `Ends ${day(c.expires_at)}` : "No end date"}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <CouponToggle id={c.id} code={c.code} active={c.active} />
                    <Link href={`/store/admin/coupons/${c.id}`} className="inline-flex min-h-11 items-center px-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline decoration-yellow decoration-2 underline-offset-4">
                      Edit
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  {["Code", "Discount", "For", "Used", "Ends", "Made", "On"].map((h) => (
                    <th key={h} className="mono-label px-5 py-2.5 font-bold md:px-8">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const s = state(c, now);
                  return (
                    <tr key={c.id} className="border-b border-rule hover:bg-bone">
                      <td className="px-5 py-3 md:px-8">
                        <Link href={`/store/admin/coupons/${c.id}`} className="font-mono font-bold hover:underline">{c.code}</Link>
                        {c.description && <div className="max-w-[260px] truncate text-[12px] text-[color:var(--text-tertiary)]">{c.description}</div>}
                      </td>
                      <td className="px-5 py-3 md:px-8">{describeDiscount(c)}</td>
                      <td className="max-w-[220px] truncate px-5 py-3 md:px-8">{scope(c)}</td>
                      <td className="px-5 py-3 tabular-nums md:px-8">{usage(c)}</td>
                      <td className="px-5 py-3 md:px-8">{c.expires_at ? day(c.expires_at) : "No end date"}</td>
                      <td className="px-5 py-3 font-mono text-[11px] text-[color:var(--text-tertiary)] md:px-8">{c.created_at ? day(c.created_at) : ""}</td>
                      <td className="px-5 py-3 md:px-8">
                        <div className="flex items-center gap-2">
                          <StatusPill tone={s.tone}>{s.label}</StatusPill>
                          <CouponToggle id={c.id} code={c.code} active={c.active} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
