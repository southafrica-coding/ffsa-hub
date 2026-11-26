import Link from "next/link";
import { Kpi, KpiStrip, Masthead, MastheadAction, SectionBar, StatusPill } from "@/components/ffsa";
import { kindLabel } from "@/lib/store/catalogue";
import { formatZar } from "@/lib/store/money";
import { fulfilmentLabel } from "@/lib/store/settle";
import type { FulfilmentStatus, StoreOrder, StoreProduct } from "@/lib/store/types";
import { listAllProducts, listOrders } from "@/services/store";
import { storeAdminGuard } from "./guard";

export const dynamic = "force-dynamic";

type OrderRow = StoreOrder & {
  store_order_items: Array<{ title: string; quantity: number; purpose: string }>;
  store_fulfilments: Array<{ status: FulfilmentStatus }> | { status: FulfilmentStatus } | null;
};

const fulfilmentOf = (o: OrderRow) => (Array.isArray(o.store_fulfilments) ? o.store_fulfilments[0] : o.store_fulfilments) ?? null;

export default async function StoreAdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const { supabase, canManage } = await storeAdminGuard();
  const [{ data: productRows, error: pErr }, { data: orderRows, error: oErr }] = await Promise.all([listAllProducts(supabase), listOrders(supabase, { limit: 300 })]);
  const products = (productRows ?? []) as StoreProduct[];
  const orders = (orderRows ?? []) as OrderRow[];

  const eftWaiting = orders.filter((o) => o.status === "pending" && o.payment_method === "eft");
  const toPack = orders.filter((o) => o.status === "paid" && ["to_pack", "ready_to_collect"].includes(fulfilmentOf(o)?.status ?? ""));
  const paid = orders.filter((o) => o.status === "paid");
  const since = Date.now() - 30 * 86_400_000;
  const takings30 = paid.filter((o) => o.paid_at && new Date(o.paid_at).getTime() >= since).reduce((s, o) => s + o.total_cents, 0);
  const todo = eftWaiting.length + toPack.length;

  const shown =
    view === "eft" ? eftWaiting : view === "pack" ? toPack : orders.slice(0, 50);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Media · Store"
        title="Store"
        actions={
          <>
            <a href="/api/store/admin/orders/export" className="inline-flex min-h-11 items-center border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone-2">Export orders</a>
            <Link href="/store" className="inline-flex min-h-11 items-center border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone-2">View store</Link>
            {canManage && (
              <Link href="/store/admin/coupons" className="inline-flex min-h-11 items-center border border-ink bg-bone px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone-2">Coupons</Link>
            )}
            {canManage && <MastheadAction href="/store/admin/products/new">New product</MastheadAction>}
          </>
        }
      />

      {todo > 0 && (
        <div className="needs-you">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="needs-you-tag">TO DO</span>
            <span className="needs-you-text">
              {[
                eftWaiting.length ? `${eftWaiting.length} EFT ${eftWaiting.length === 1 ? "order is" : "orders are"} waiting to be checked` : null,
                toPack.length ? `${toPack.length} ${toPack.length === 1 ? "order" : "orders"} to pack or hand over` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <Link href={eftWaiting.length ? "/store/admin?view=eft" : "/store/admin?view=pack"} className="inline-flex min-h-11 shrink-0 items-center border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-yellow hover:bg-[var(--ink-bg-hover)]">
            Show me
          </Link>
        </div>
      )}

      <KpiStrip>
        <Kpi label="Paid, last 30 days" value={formatZar(takings30)} size={30} lead tick={todo === 0} />
        <Kpi label="Paid orders" value={String(paid.length)} />
        <Kpi label="Products live" value={String(products.filter((p) => p.status === "published").length)} foot={`${products.length} in all`} />
        <Kpi label="Waiting on EFT" value={String(eftWaiting.length)} />
      </KpiStrip>

      {(pErr || oErr) && (
        <p className="border-b border-rule bg-bone px-5 py-3 text-[13px] md:px-8">
          The Store tables didn&apos;t load. Has migration 412 been applied to this database? ({pErr?.message ?? oErr?.message})
        </p>
      )}

      <SectionBar title="Products" meta={`${products.length}`} />
      {products.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-[color:var(--text-secondary)] md:px-8">No products yet.{canManage && " Add the first one with New product."}</p>
      ) : (
        <>
        {/* Phones: one card per product, the whole card a link. The table is md and up. */}
        <ul className="md:hidden">
          {products.map((p) => (
            <li key={p.id} className="border-b border-rule">
              <Link href={`/store/admin/products/${p.id}`} className="block min-w-0 px-5 py-3.5 active:bg-bone">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-semibold leading-snug">{p.title}</span>
                  <span className="shrink-0 tabular-nums font-semibold">{formatZar(p.price_cents)}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-[color:var(--text-tertiary)]">/store/p/{p.slug}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <StatusPill tone={p.status === "published" ? "good" : p.status === "draft" ? "warn" : "quiet"}>{p.status}</StatusPill>
                  <span className="text-[color:var(--text-secondary)]">{kindLabel(p.kind)}{p.is_preorder ? " · preorder" : ""}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                {["Product", "Kind", "Price", "Status"].map((h) => (
                  <th key={h} className="mono-label px-5 py-2.5 font-bold md:px-8">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-rule hover:bg-bone">
                  <td className="px-5 py-3 md:px-8">
                    <Link href={`/store/admin/products/${p.id}`} className="font-semibold hover:underline">{p.title}</Link>
                    <div className="font-mono text-[10px] text-[color:var(--text-tertiary)]">/store/p/{p.slug}</div>
                  </td>
                  <td className="px-5 py-3 md:px-8">{kindLabel(p.kind)}{p.is_preorder ? " · preorder" : ""}</td>
                  <td className="px-5 py-3 tabular-nums md:px-8">{formatZar(p.price_cents)}</td>
                  <td className="px-5 py-3 md:px-8">
                    <StatusPill tone={p.status === "published" ? "good" : p.status === "draft" ? "warn" : "quiet"}>{p.status}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <SectionBar title={view === "eft" ? "Waiting on EFT" : view === "pack" ? "To pack or hand over" : "Recent orders"} meta={view ? <Link href="/store/admin" className="underline">ALL ORDERS</Link> : `${orders.length}`} />
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-[color:var(--text-secondary)] md:px-8">No orders here.</p>
      ) : (
        <>
        <ul className="md:hidden">
          {shown.map((o) => {
            const f = fulfilmentOf(o);
            return (
              <li key={o.id} className="border-b border-rule">
                <Link href={`/store/admin/orders/${o.id}`} className="block min-w-0 px-5 py-3.5 active:bg-bone">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono font-bold">{o.reference}</span>
                    <span className="shrink-0 tabular-nums font-semibold">{formatZar(o.total_cents)}</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">{o.buyer_name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[color:var(--text-tertiary)]">{new Date(o.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-[color:var(--text-secondary)]">{o.store_order_items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}`).join(", ")}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <StatusPill tone={o.status === "paid" ? "good" : o.status === "pending" ? "warn" : "quiet"}>{o.status === "pending" && o.payment_method === "eft" ? "EFT due" : o.status}</StatusPill>
                    {f && <StatusPill tone="quiet">{fulfilmentLabel(f.status)}</StatusPill>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left">
                {["Order", "Buyer", "Items", "Total", "Status"].map((h) => (
                  <th key={h} className="mono-label px-5 py-2.5 font-bold md:px-8">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const f = fulfilmentOf(o);
                return (
                  <tr key={o.id} className="border-b border-rule hover:bg-bone">
                    <td className="px-5 py-3 md:px-8">
                      <Link href={`/store/admin/orders/${o.id}`} className="font-mono font-bold hover:underline">{o.reference}</Link>
                      <div className="font-mono text-[10px] text-[color:var(--text-tertiary)]">{new Date(o.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</div>
                    </td>
                    <td className="max-w-[200px] truncate px-5 py-3 md:px-8">{o.buyer_name}</td>
                    <td className="px-5 py-3 md:px-8">{o.store_order_items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}`).join(", ")}</td>
                    <td className="px-5 py-3 tabular-nums md:px-8">{formatZar(o.total_cents)}</td>
                    <td className="space-x-1 px-5 py-3 md:px-8">
                      <StatusPill tone={o.status === "paid" ? "good" : o.status === "pending" ? "warn" : "quiet"}>{o.status === "pending" && o.payment_method === "eft" ? "EFT due" : o.status}</StatusPill>
                      {f && <StatusPill tone="quiet">{fulfilmentLabel(f.status)}</StatusPill>}
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
