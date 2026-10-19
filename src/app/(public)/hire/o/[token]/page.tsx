// "My rental" (frames 47a-6, 46e right): no login, the token in the emailed
// link is the key. Status run, return time, the units once packed, and
// Extend / Report an issue / Invoice. A ministry request shows it's waiting
// on the rental manager and can be withdrawn.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils/cn";
import {
  getOrderByToken,
  insertEquipmentEvent,
  markOrderPaymentsStatus,
  moveOrderIfStatus,
  type EquipmentOrderFull,
} from "@/services/equipment";
import { dayLabel, rangeLabel } from "@/lib/equipment/dates";
import { rands } from "@/lib/equipment/money";
import { RentalActions } from "./rental-actions";
import { ClearCartOnPaid } from "./clear-cart";

export const metadata: Metadata = { title: "Your rental · Hire · Fire & Fragrance", robots: { index: false } };

const RUN = ["Booked", "Packed", "Out", "Back", "Deposit"] as const;

/** How far along the run an order is (frame 47a-6). */
function runStep(status: string): number {
  switch (status) {
    case "confirmed":
      return 0;
    case "prepping":
      return 1;
    case "out":
      return 2;
    case "returned":
    case "inspected":
      return 3;
    case "closed":
      return 4;
    default:
      return -1;
  }
}

function headline(o: EquipmentOrderFull): string {
  switch (o.status) {
    case "awaiting_payment":
      return "Waiting for your payment";
    case "requested":
      return "Waiting on the rental manager";
    case "confirmed":
      return `Booked for ${rangeLabel(o.starts_on, o.ends_on)}`;
    case "prepping":
      return "Packed and ready to collect";
    case "out":
      return `Out with you until ${dayLabel(o.ends_on)}`;
    case "returned":
    case "inspected":
      return "Back with us, being checked";
    case "closed":
      return "All done";
    case "declined":
      return "Not approved";
    case "cancelled":
      return "Cancelled";
    default:
      return "Your rental";
  }
}

export default async function RentalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; cancelled?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const admin = createAdminClient();
  const { data } = await getOrderByToken(admin, token);
  let order = data as EquipmentOrderFull | null;
  if (!order) notFound();

  // Back from PayFast's cancel link: release the hold straight away rather
  // than leave it blocking the gear (and their own retry) for half an hour.
  if (sp.cancelled === "1" && order.status === "awaiting_payment") {
    const { data: moved } = await moveOrderIfStatus(admin, order.id, ["awaiting_payment"], {
      status: "cancelled",
      hold_expires_at: null,
    });
    if (moved) {
      await markOrderPaymentsStatus(admin, order.id, "cancelled");
      await insertEquipmentEvent(admin, { order_id: order.id, kind: "payment_cancelled", detail: "Came back from PayFast without paying. The gear was released." });
      order = { ...order, status: "cancelled" };
    }
  }

  const internal = order.kind === "internal";
  const step = runStep(order.status);
  const paidPending = sp.paid === "1" && order.status === "awaiting_payment";
  const hire = order.payments.find((p) => p.kind === "hire");
  const tagsByLine = new Map<string, string[]>();
  for (const u of order.units) {
    if (!u.unit) continue;
    const list = tagsByLine.get(u.line_id) ?? [];
    list.push(u.unit.tag);
    tagsByLine.set(u.line_id, list);
  }

  return (
    <main className="px-[18px] pb-10 pt-4 md:mx-auto md:max-w-[760px] md:px-0 md:pt-10">
      {sp.paid === "1" && <ClearCartOnPaid />}
      <div className="flex items-baseline justify-between text-[13px] text-[color:var(--hire-muted)]">
        <span>
          Rentals · {order.number}
          {internal && order.ministry ? ` · for ${order.ministry.name}` : ""}
        </span>
        {internal && <span className="text-[12px] uppercase tracking-[0.14em] text-[color:var(--hire-accent)]">Internal</span>}
      </div>
      <h1 className="hire-display mt-1 text-[44px] md:text-[64px]">
        {order.purpose && internal ? `${order.purpose}, ${dayLabel(order.starts_on)}` : headline(order)}
      </h1>

      {paidPending && (
        <div className="mt-4 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] px-4 py-3 text-[14px]">
          Thanks. PayFast is confirming your payment; this page shows it once it lands. Refresh in a minute.
        </div>
      )}
      {sp.cancelled === "1" && order.status === "cancelled" && (
        <div className="mt-4 rounded-[8px] border border-[color:var(--hire-accent)] bg-[#221C10] px-4 py-3 text-[14px] text-[color:var(--hire-ink)]">
          The payment didn&apos;t go through, so nothing was charged. Your cart is still saved.{" "}
          <a href="/hire/checkout" className="font-bold underline underline-offset-4">
            Back to checkout
          </a>
        </div>
      )}
      {order.status === "requested" && (
        <div className="mt-4 flex flex-col gap-1.5 rounded-[8px] border border-[color:var(--hire-accent)] bg-[#221C10] px-[18px] py-4">
          <span className="text-[15px] font-bold text-[color:var(--hire-ink)]">Waiting on the rental manager</span>
          <span className="text-[14px]">The gear is held for you until it&apos;s approved or declined. You&apos;ll get an email either way.</span>
        </div>
      )}
      {order.status === "declined" && order.decline_reason && (
        <p className="mt-4 text-[14px]">
          <b className="text-[color:var(--hire-ink)]">Why:</b> {order.decline_reason}
        </p>
      )}

      {step >= 0 && (
        <ol className="mt-5 grid grid-cols-5 gap-1">
          {RUN.map((label, i) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span className={cn("h-1.5 rounded-[2px]", i <= step ? "bg-[color:var(--hire-accent)]" : "bg-[color:var(--hire-line2)]")} />
              <span className={cn("text-[12px]", i === step ? "font-bold text-[color:var(--hire-ink)]" : "text-[color:var(--hire-muted)]")}>{label}</span>
            </li>
          ))}
        </ol>
      )}

      {["confirmed", "prepping", "out"].includes(order.status) && (
        <div className="mt-5 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] px-4 py-3.5">
          <div className="text-[15px] font-bold text-[color:var(--hire-ink)]">
            {order.status === "out" ? "Return by" : "Collect"} {dayLabel(order.status === "out" ? order.ends_on : order.starts_on)}
            {order.status === "out"
              ? order.return_time && `, ${order.return_time.slice(0, 5)}`
              : order.collect_time && `, ${order.collect_time.slice(0, 5)}`}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed">
            {order.fulfilment === "delivery"
              ? `We deliver to ${order.delivery_address}. We'll confirm the delivery cost and time with you.`
              : "At the FFSA base. We check everything with you there"}
            {order.fulfilment === "collect" && (internal ? "." : " and the deposit is refunded once it's checked back in.")}
          </p>
          {order.status !== "out" && (
            <p className="mt-1 text-[13px] text-[color:var(--hire-muted)]">
              Back {dayLabel(order.ends_on)}
              {order.return_time ? ` by ${order.return_time.slice(0, 5)}` : ""}.
            </p>
          )}
        </div>
      )}

      <ul className="mt-5 flex flex-col">
        {order.lines.map((l) => {
          const p = l.product;
          const title = p ? [p.brand, p.model].filter(Boolean).join(" ") || p.name : "Item";
          const tags = tagsByLine.get(l.id);
          return (
            <li key={l.id} className="flex items-baseline justify-between gap-3 border-b border-[color:var(--hire-line)] py-3 text-[14px]">
              <span className="text-[color:var(--hire-ink)]">
                {l.quantity} × {title}
              </span>
              <span className="hire-mono text-right text-[12px] text-[color:var(--hire-muted)]">
                {tags?.length ? tags.join(", ") : internal ? "" : rands(l.line_total_cents)}
              </span>
            </li>
          );
        })}
      </ul>

      {!internal && (
        <div className="mt-3 flex flex-col gap-1 text-[14px]">
          <div className="flex justify-between">
            <span>Hire, incl. VAT{order.waiver_cents ? " and waiver" : ""}</span>
            <span className="text-[color:var(--hire-ink)]">{rands(order.total_cents)}</span>
          </div>
          <div className="flex justify-between">
            <span>Refundable deposit</span>
            <span className="text-[color:var(--hire-ink)]">{rands(order.deposit_cents)}</span>
          </div>
        </div>
      )}
      {internal && <p className="mt-3 text-[13px]">No deposit for ministry wings. Damage is charged to the wing&apos;s budget.</p>}

      <RentalActions
        token={token}
        status={order.status}
        internal={internal}
        endsOn={order.ends_on}
        invoiceNumber={hire?.xero_invoice_number ?? null}
        email={order.customer_email}
      />
    </main>
  );
}
