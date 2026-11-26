import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusPill } from "@/components/ffsa";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { thanksPath } from "@/lib/store/signing";
import { formatZar } from "@/lib/store/money";
import { fulfilmentLabel } from "@/lib/store/settle";
import type { FulfilmentStatus, StoreCode, StoreOrder, StoreOrderItem } from "@/lib/store/types";
import { listBuyerOrders, listCodesForItems } from "@/services/store";
import { AccountTabs } from "../_components/account-tabs";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type OrderRow = StoreOrder & {
  store_order_items: StoreOrderItem[];
  store_fulfilments: Array<{ status: FulfilmentStatus; method: string; tracking: string | null }> | { status: FulfilmentStatus; method: string; tracking: string | null } | null;
};

export default async function OrdersPage() {
  const supabase = await createClient();
  const buyer = await getBuyer(supabase);
  if (!buyer) redirect("/store/library");

  const { data } = await listBuyerOrders(supabase, buyer);
  const orders = (data ?? []) as OrderRow[];
  const packItems = orders.flatMap((o) => (o.status === "paid" ? o.store_order_items.filter((i) => i.purpose !== "self") : []));
  const { data: codeRows } = packItems.length ? await listCodesForItems(supabase, packItems.map((i) => i.id)) : { data: [] };
  const codes = (codeRows ?? []) as StoreCode[];

  return (
    <>
      <AccountTabs active="orders" email={buyer.email} />
      <div className="space-y-8 px-4 pt-6 md:px-8">
        {orders.length === 0 && <p className="text-[14px] text-[color:var(--text-secondary)]">No orders on this email yet.</p>}
        {orders.map((o) => {
          const f = Array.isArray(o.store_fulfilments) ? o.store_fulfilments[0] : o.store_fulfilments;
          return (
            <section key={o.id}>
              <div className="section-bar">
                <span className="section-bar-title">{o.reference}</span>
                <span className="section-bar-meta">{new Date(o.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div className="border-x border-b border-rule">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={o.status === "paid" ? "good" : o.status === "pending" ? "warn" : "quiet"}>
                      {o.status === "pending" ? (o.payment_method === "eft" ? "Waiting for EFT" : "Waiting for payment") : o.status}
                    </StatusPill>
                    {f && <StatusPill tone="quiet">{fulfilmentLabel(f.status)}</StatusPill>}
                  </div>
                  <span className="numeral text-[22px]">{formatZar(o.total_cents)}</span>
                </div>
                <ul>
                  {o.store_order_items.map((i) => {
                    const mine = codes.filter((c) => c.order_item_id === i.id);
                    return (
                      <li key={i.id} className="border-b border-rule px-4 py-3 last:border-b-0">
                        <p className="font-semibold">
                          {i.title}
                          {i.variant_label ? ` · ${i.variant_label}` : ""}
                          {i.purpose === "self" && i.quantity > 1 ? ` × ${i.quantity}` : ""}
                        </p>
                        {i.purpose === "gift" && (
                          <p className="text-[13px] text-[color:var(--text-secondary)]">
                            Gift for {i.gift_recipient_email}
                            {mine[0] ? (mine[0].redeemed_at ? " · claimed" : " · not claimed yet") : ""}
                          </p>
                        )}
                        {i.purpose === "code_pack" && mine.length > 0 && (
                          <div className="mt-2">
                            <p className="mono-label mb-1.5">
                              {mine.filter((c) => !c.redeemed_at).length} of {mine.length} codes unused · readers redeem at {""}
                              <span className="normal-case tracking-normal">/store/redeem</span>
                            </p>
                            <ul className="grid grid-cols-1 gap-1 font-mono text-[13px] tabular-nums sm:grid-cols-2">
                              {mine.map((c) => (
                                <li key={c.id} className={c.redeemed_at ? "text-[color:var(--text-quiet)] line-through" : ""}>
                                  {c.code}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {o.status === "pending" && (
                  <Link href={thanksPath(o.id)} className="block border-t border-rule px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
                    {o.payment_method === "eft" ? "EFT details and proof of payment →" : "Check payment →"}
                  </Link>
                )}
                {f?.tracking && <p className="border-t border-rule px-4 py-3 text-[13px]">Tracking: {f.tracking}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
