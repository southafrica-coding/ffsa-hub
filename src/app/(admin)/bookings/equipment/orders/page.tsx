// Orders: every hire, grouped by where it is. One yellow band, and only when
// ministry requests are waiting on the rental manager.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import { getEquipmentAccess, listOrders } from "@/services/equipment";
import { rangeLabel } from "@/lib/equipment/dates";
import { rands } from "@/lib/equipment/money";

type Row = {
  id: string;
  number: string;
  kind: string;
  status: string;
  customer_name: string;
  customer_org: string | null;
  starts_on: string;
  ends_on: string;
  total_cents: number;
  purpose: string | null;
  hold_expires_at: string | null;
  ministry: { name: string } | null;
  lines: { quantity: number }[];
};

const GROUPS: { title: string; statuses: string[] }[] = [
  { title: "Waiting on approval", statuses: ["requested"] },
  { title: "Booked", statuses: ["confirmed", "prepping"] },
  { title: "Out", statuses: ["out"] },
  { title: "Back, being checked", statuses: ["returned", "inspected"] },
  { title: "Waiting for payment", statuses: ["awaiting_payment"] },
  { title: "Done", statuses: ["closed"] },
  { title: "Declined or cancelled", statuses: ["declined", "cancelled"] },
];

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data }, access] = await Promise.all([listOrders(supabase), user ? getEquipmentAccess(supabase, user.id) : null]);
  const orders = (data ?? []) as Row[];
  const now = Date.now();
  const live = orders.filter(
    (o) => !(o.status === "awaiting_payment" && o.hold_expires_at && Date.parse(o.hold_expires_at) < now)
  );
  const waiting = live.filter((o) => o.status === "requested");

  return (
    <div className="pb-8">
      <header className="border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-4 md:px-9 md:pb-5 md:pt-7">
        <div className="text-[13px] text-[color:var(--hire-muted)]">Equipment hire</div>
        <h1 className="hire-display mt-0.5 text-[52px] md:text-[72px]">Orders</h1>
      </header>

      {access?.canManage && waiting.length > 0 && (
        <Link
          href={`/bookings/equipment/orders/${waiting[0].id}`}
          className="flex flex-col gap-1 bg-[color:var(--hire-accent)] px-[18px] py-3.5 text-[15px] text-[color:var(--hire-on-accent)] md:flex-row md:items-center md:justify-between md:px-9"
        >
          <span>
            <b>
              {waiting.length} ministry {waiting.length === 1 ? "request is" : "requests are"} waiting on your approval.
            </b>{" "}
            {waiting[0].purpose ?? waiting[0].customer_name} is the soonest, on {rangeLabel(waiting[0].starts_on, waiting[0].ends_on)}.
          </span>
          <span className="font-bold underline underline-offset-4">Review</span>
        </Link>
      )}

      {live.length === 0 && <p className="px-[18px] py-8 text-[15px] md:px-9">No orders yet.</p>}

      {GROUPS.map((g) => {
        const rows = live.filter((o) => g.statuses.includes(o.status));
        if (rows.length === 0) return null;
        return (
          <section key={g.title}>
            <h2 className="hire-label bg-[color:var(--hire-surface)] px-[18px] py-2.5 font-bold md:px-9">
              {g.title} · {rows.length}
            </h2>
            <ul>
              {rows.map((o) => (
                <li key={o.id} className="border-b border-[color:var(--hire-line)]">
                  <Link
                    href={`/bookings/equipment/orders/${o.id}`}
                    className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-2.5 hover:bg-[color:var(--hire-surface)] md:grid-cols-[110px_minmax(0,1fr)_200px_90px_120px] md:px-9"
                  >
                    <span className="hire-mono hidden text-[12px] text-[color:var(--hire-ink)] md:inline">{o.number}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] text-[color:var(--hire-ink)] md:text-[14px]">
                        {o.purpose ?? o.customer_org ?? o.customer_name}
                      </span>
                      <span className="block truncate text-[12px] text-[color:var(--hire-muted)]">
                        <span className="md:hidden">{o.number} · </span>
                        {o.kind === "internal" ? `${o.ministry?.name ?? "Ministry"} · ${o.customer_name}` : o.customer_name}
                        <span className="md:hidden"> · {rangeLabel(o.starts_on, o.ends_on)}</span>
                      </span>
                    </span>
                    <span className="hidden text-[13px] md:inline">{rangeLabel(o.starts_on, o.ends_on)}</span>
                    <span className="hidden text-[13px] md:inline">
                      {o.lines.reduce((n, l) => n + l.quantity, 0)} items
                    </span>
                    <span
                      className={cn(
                        "text-right text-[13px]",
                        o.kind === "internal" ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ink)]"
                      )}
                    >
                      {o.kind === "internal" ? "Internal" : rands(o.total_cents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
