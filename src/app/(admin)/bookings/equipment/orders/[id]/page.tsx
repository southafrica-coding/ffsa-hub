// One order (frame 47d phone): who, when, what, whether it all still fits,
// money, history — and for a ministry request, Approve / Decline.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import {
  freeCount,
  getEquipmentAccess,
  getEquipmentSettings,
  getOrderById,
  getProductsByIds,
  listOrderEvents,
  type EquipmentEvent,
  type EquipmentOrderFull,
  type EquipmentProduct,
  type EquipmentSettings,
} from "@/services/equipment";
import { dayLabel, rangeLabel } from "@/lib/equipment/dates";
import { rands } from "@/lib/equipment/money";
import { quote } from "@/lib/equipment/pricing";
import { sastDate } from "@/lib/equipment/register";
import { OrderActions } from "./order-actions";

const RUN = ["requested", "confirmed", "prepping", "out", "returned", "inspected", "closed"];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await getOrderById(supabase, id);
  const order = data as EquipmentOrderFull | null;
  if (!order) notFound();

  const [access, eventsRes, settingsRes, productsRes] = await Promise.all([
    user ? getEquipmentAccess(supabase, user.id) : null,
    listOrderEvents(supabase, id),
    getEquipmentSettings(supabase),
    getProductsByIds(
      supabase,
      order.lines.map((l) => l.product_id)
    ),
  ]);
  const events = (eventsRes.data ?? []) as EquipmentEvent[];
  const products = new Map(((productsRes.data ?? []) as EquipmentProduct[]).map((p) => [p.id, p]));

  // Does each line still fit, counting everyone else's orders?
  const fits = await Promise.all(
    order.lines.map(async (l) => {
      const { data: free } = await freeCount(supabase, l.product_id, order.starts_on, order.ends_on, order.id);
      return (free ?? 0) >= l.quantity;
    })
  );

  const internal = order.kind === "internal";
  const publicPrice = internal
    ? quote(
        order.lines.filter((l) => products.has(l.product_id)).map((l) => ({ product: products.get(l.product_id)!, quantity: l.quantity })),
        order.starts_on,
        order.ends_on,
        "external",
        (settingsRes.data as EquipmentSettings | null) ?? { vat_bps: 1500, waiver_bps: 1000 }
      ).subtotalCents
    : null;

  // The newest extension request that hasn't been applied yet.
  const lastExtended = events.find((e) => e.kind === "extended");
  const ext = events.find((e) => e.kind === "extension_requested" && (!lastExtended || e.at > lastExtended.at));
  const extEnd = ext?.detail?.split("|")[0];
  const pendingExtension = extEnd && extEnd > order.ends_on ? extEnd : null;

  const step = RUN.indexOf(order.status);
  const times = [order.collect_time && `collect ${order.collect_time.slice(0, 5)}`, order.return_time && `back ${dayLabel(order.ends_on).split(" ")[0]} ${order.return_time.slice(0, 5)}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="pb-[150px] md:pb-10">
      <header className="border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:px-9 md:pb-5 md:pt-6">
        <Link
          href="/bookings/equipment/orders"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-[color:var(--hire-muted)] hover:text-[color:var(--hire-ink)] md:min-h-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Orders
        </Link>
        <div className="text-[13px] text-[color:var(--hire-muted)]">
          {order.number} · {internal ? "internal" : "outside hire"}
        </div>
        <h1 className="hire-display mt-0.5 text-[44px] md:text-[64px]">{order.purpose ?? order.customer_org ?? order.customer_name}</h1>
        <p className="mt-1 text-[14px] text-[color:var(--hire-ink)]">
          {rangeLabel(order.starts_on, order.ends_on)}
          {times ? ` · ${times}` : ""}
        </p>
        <p className="text-[13px]">
          {internal ? "Asked by" : "Booked by"} {order.customer_name}
          {order.ministry ? `, ${order.ministry.name}` : order.customer_org ? `, ${order.customer_org}` : ""}
        </p>
      </header>

      {order.status === "awaiting_payment" && (
        <p className="border-b border-[color:var(--hire-line)] px-[18px] py-3 text-[14px] md:px-9">
          Waiting for PayFast.{" "}
          {order.hold_expires_at && Date.parse(order.hold_expires_at) < Date.now()
            ? "The hold has run out, so it no longer blocks the gear."
            : "The gear is held until the payment lands or the hold runs out."}
        </p>
      )}

      {step >= 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1 border-b border-[color:var(--hire-line)] px-[18px] py-3 text-[13px] md:px-9">
          {RUN.slice(internal ? 0 : 1).map((s) => (
            <span
              key={s}
              className={cn(
                s === order.status ? "font-bold text-[color:var(--hire-accent)]" : RUN.indexOf(s) < step ? "text-[color:var(--hire-ink)]" : "text-[color:var(--hire-dim)]"
              )}
            >
              {s === "requested" ? "Requested" : s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          ))}
        </div>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px]">
        <div className="md:border-r md:border-[color:var(--hire-line)]">
          <ul>
            {order.lines.map((l, i) => {
              const p = l.product;
              const title = p ? [p.brand, p.model].filter(Boolean).join(" ") || p.name : "Item";
              const tags = order.units.filter((u) => u.line_id === l.id && u.unit).map((u) => u.unit!.tag);
              const holding = ["requested", "confirmed", "prepping", "awaiting_payment"].includes(order.status);
              return (
                <li key={l.id} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[color:var(--hire-line)] px-[18px] py-2.5 md:px-9">
                  <span className="min-w-0">
                    <span className="block text-[15px] text-[color:var(--hire-ink)]">
                      {l.quantity} × {title}
                    </span>
                    {tags.length > 0 && <span className="hire-mono block text-[12px] text-[color:var(--hire-muted)]">{tags.join(", ")}</span>}
                  </span>
                  <span className="shrink-0 text-right text-[13px]">
                    {holding && (
                      <span className={fits[i] ? "text-[color:var(--hire-ok)]" : "font-bold text-[color:var(--hire-accent)]"}>
                        {fits[i] ? "free" : "clash"}
                      </span>
                    )}
                    {!internal && <span className="block text-[color:var(--hire-ink)]">{rands(l.line_total_cents)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-1 px-[18px] py-3 text-[14px] md:px-9">
            {internal ? (
              <div>
                Internal rate <b className="text-[color:var(--hire-ink)]">{rands(order.subtotal_cents)}</b>
                {publicPrice != null && ` · public ${rands(publicPrice)}`}
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Hire</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(order.subtotal_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Waiver</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(order.waiver_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(order.vat_cents)}</span>
                </div>
                <div className="flex justify-between font-bold text-[color:var(--hire-ink)]">
                  <span>Hire total</span>
                  <span>{rands(order.total_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deposit</span>
                  <span className="text-[color:var(--hire-ink)]">{rands(order.deposit_cents)}</span>
                </div>
              </>
            )}
            {order.status === "requested" && (
              <p className="mt-1 text-[13px] text-[color:var(--hire-muted)]">
                All units are held until you decide. {order.customer_name.split(" ")[0]} gets an email either way.
              </p>
            )}
          </div>

          {events.length > 0 && (
            <section className="mt-2">
              <h2 className="hire-label bg-[color:var(--hire-surface)] px-[18px] py-2.5 font-bold md:px-9">History</h2>
              <ul>
                {events.map((e) => (
                  <li key={e.id} className="border-b border-[color:var(--hire-line)] px-[18px] py-2.5 text-[13px] md:px-9">
                    <div className="flex justify-between gap-3 text-[color:var(--hire-ink)]">
                      <span>{e.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</span>
                      <span className="text-[12px] text-[color:var(--hire-muted)]">{sastDate(e.at)}</span>
                    </div>
                    {e.detail && <div className="mt-0.5">{e.kind === "extension_requested" ? e.detail.split("|").slice(2).join("|") : e.detail}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4 px-[18px] py-4 md:bg-[color:var(--hire-surface)] md:px-7 md:py-6">
          <div>
            <div className="hire-label mb-1.5">Contact</div>
            <div className="text-[14px] text-[color:var(--hire-ink)]">{order.customer_name}</div>
            <a href={`mailto:${order.customer_email}`} className="block text-[14px] underline underline-offset-4">
              {order.customer_email}
            </a>
            {order.customer_phone && (
              <a href={`tel:${order.customer_phone}`} className="block text-[14px] underline underline-offset-4">
                {order.customer_phone}
              </a>
            )}
          </div>
          {!internal && (
            <div>
              <div className="hire-label mb-1.5">ID to check at collection</div>
              <div className="hire-mono text-[14px] text-[color:var(--hire-ink)]">{order.customer_id_number ?? "Not given"}</div>
            </div>
          )}
          <div>
            <div className="hire-label mb-1.5">Getting it</div>
            <div className="text-[14px]">
              {order.fulfilment === "delivery" ? `Delivery to ${order.delivery_address}` : "Collect from the base"}
            </div>
          </div>
          {order.payments.length > 0 && (
            <div>
              <div className="hire-label mb-1.5">Payments</div>
              {order.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-[14px]">
                  <span className="capitalize">{p.kind.replace("_", " ")}</span>
                  <span className={p.status === "paid" ? "text-[color:var(--hire-ok)]" : ""}>
                    {rands(p.amount_cents)} · {p.status}
                    {p.xero_invoice_number ? ` · ${p.xero_invoice_number}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {order.agreement_signed_name && (
            <div className="text-[13px]">
              Agreement {order.agreement_version} signed by {order.agreement_signed_name}
              {order.agreement_accepted_at ? ` on ${sastDate(order.agreement_accepted_at)}` : ""}.
            </div>
          )}
          <Link href={`/hire/o/${order.access_token}`} className="text-[13px] underline underline-offset-4">
            See what the customer sees
          </Link>
        </aside>
      </div>

      {access?.canManage && (
        <OrderActions orderId={order.id} status={order.status} pendingExtension={pendingExtension} />
      )}
    </div>
  );
}
