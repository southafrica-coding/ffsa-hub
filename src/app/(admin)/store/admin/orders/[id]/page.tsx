import { notFound } from "next/navigation";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { formatZar } from "@/lib/store/money";
import { fulfilmentLabel, nextFulfilmentSteps } from "@/lib/store/settle";
import type { StoreCode, StoreFulfilment, StoreOrder, StoreOrderItem } from "@/lib/store/types";
import { getFulfilment, getOrder, getOrderItems, listCodesForItems } from "@/services/store";
import { storeAdminGuard } from "../../guard";
import { OrderActions } from "./order-actions";

export const dynamic = "force-dynamic";

export default async function StoreOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canManage } = await storeAdminGuard();
  const { data } = await getOrder(supabase, id);
  const order = data as StoreOrder | null;
  if (!order) notFound();
  const [{ data: itemRows }, { data: f }] = await Promise.all([getOrderItems(supabase, id), getFulfilment(supabase, id)]);
  const items = (itemRows ?? []) as StoreOrderItem[];
  const fulfilment = f as StoreFulfilment | null;
  const { data: codeRows } = await listCodesForItems(supabase, items.map((i) => i.id));
  const codes = (codeRows ?? []) as StoreCode[];
  const a = order.delivery_address;

  return (
    <div className="ffsa-screen">
      <Masthead context={`Store · ${order.payment_method === "eft" ? "EFT" : order.payment_method === "stripe" ? "International card" : "SA card"} · ${new Date(order.created_at).toLocaleString("en-ZA")}`} title={order.reference} />

      <div className="grid border-b border-ink md:grid-cols-3">
        <div className="border-b border-rule px-5 py-4 md:border-b-0 md:border-r md:px-8">
          <div className="mono-label mb-1.5">Status</div>
          <StatusPill tone={order.status === "paid" ? "good" : order.status === "pending" ? "warn" : "quiet"}>{order.status}</StatusPill>
          {order.paid_at && <p className="mt-1.5 text-[12px] text-[color:var(--text-tertiary)]">Paid {new Date(order.paid_at).toLocaleString("en-ZA")}</p>}
        </div>
        <div className="border-b border-rule px-5 py-4 md:border-b-0 md:border-r md:px-8">
          <div className="mono-label mb-1.5">Buyer</div>
          <p className="font-semibold">{order.buyer_name}</p>
          <p className="break-all text-[13px]">{order.buyer_email}</p>
          {order.buyer_phone && <p className="text-[13px]">{order.buyer_phone}</p>}
        </div>
        <div className="px-5 py-4 md:px-8">
          <div className="mono-label mb-1.5">Total</div>
          <p className="numeral text-[34px]">{formatZar(order.total_cents)}</p>
          {order.delivery_cents > 0 && <p className="text-[12px] text-[color:var(--text-tertiary)]">incl. {formatZar(order.delivery_cents)} delivery</p>}
        </div>
      </div>

      <SectionBar title="Items" meta={`${items.length}`} />
      <ul>
        {items.map((i) => {
          const mine = codes.filter((c) => c.order_item_id === i.id);
          return (
            <li key={i.id} className="border-b border-rule px-5 py-3 md:px-8">
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{i.quantity > 1 ? `${i.quantity}× ` : ""}{i.title}{i.variant_label ? ` · ${i.variant_label}` : ""}</span>
                <span className="tabular-nums">{formatZar(i.unit_price_cents * i.quantity)}</span>
              </div>
              {i.purpose === "gift" && <p className="text-[13px] text-[color:var(--text-secondary)]">Gift for {i.gift_recipient_email}{mine[0] ? ` · code ${mine[0].code}${mine[0].redeemed_at ? " (claimed)" : ""}` : ""}</p>}
              {i.purpose === "code_pack" && <p className="text-[13px] text-[color:var(--text-secondary)]">Code pack · {mine.filter((c) => c.redeemed_at).length} of {mine.length} redeemed</p>}
            </li>
          );
        })}
      </ul>

      {fulfilment && (
        <>
          <SectionBar title={fulfilment.method === "delivery" ? "Delivery" : "Collect at base"} meta={fulfilmentLabel(fulfilment.status).toUpperCase()} />
          <div className="px-5 py-4 md:px-8">
            {a && <p className="mb-3 text-[14px]">{[a.line1, a.line2, a.city, a.province, a.postal_code].filter(Boolean).join(", ")}</p>}
            {fulfilment.tracking && <p className="mb-3 text-[13px]">Tracking: {fulfilment.tracking}</p>}
          </div>
        </>
      )}

      {canManage && (
        <OrderActions
          orderId={order.id}
          canMarkPaid={order.status === "pending" && order.payment_method === "eft"}
          canCancel={order.status === "pending"}
          hasProof={!!order.eft_proof_path}
          fulfilment={fulfilment ? { method: fulfilment.method, next: nextFulfilmentSteps(fulfilment.method, fulfilment.status).map((s) => ({ id: s, label: fulfilmentLabel(s) })) } : null}
        />
      )}
    </div>
  );
}
