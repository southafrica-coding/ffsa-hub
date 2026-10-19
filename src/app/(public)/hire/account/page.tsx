// "Rentals" (spec, Routes): every order a signed-in customer has placed.
// Without an account, the emailed /hire/o/[token] link is the way in.

import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listMyOrders } from "@/services/equipment";
import { rangeLabel } from "@/lib/equipment/dates";

export const metadata: Metadata = { title: "Your rentals · Hire · Fire & Fragrance" };

const STATUS: Record<string, string> = {
  awaiting_payment: "Waiting for payment",
  requested: "Waiting on approval",
  confirmed: "Booked",
  prepping: "Packed",
  out: "Out with you",
  returned: "Being checked",
  inspected: "Being checked",
  closed: "Done",
  declined: "Not approved",
  cancelled: "Cancelled",
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="px-[18px] py-10 md:px-10 md:py-14">
        <h1 className="hire-display text-[52px] md:text-[80px]">Rentals</h1>
        <p className="mt-3 max-w-[480px] text-[15px] leading-relaxed">
          Every booking email has a link to its own rental page, no account needed. If you booked while signed in to the Hub,
          sign in to see them all here.
        </p>
        <Link
          href="/login?redirect=/hire/account"
          className="mt-5 inline-flex h-12 items-center rounded-[8px] bg-[color:var(--hire-accent)] px-6 font-bold text-[color:var(--hire-on-accent)]"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const { data } = await listMyOrders(supabase, user.id);
  const orders = (data ?? []) as {
    id: string;
    number: string;
    kind: string;
    status: string;
    starts_on: string;
    ends_on: string;
    purpose: string | null;
    access_token: string;
  }[];

  return (
    <main className="px-[18px] py-4 md:px-10 md:py-10">
      <h1 className="hire-display text-[52px] md:text-[80px]">Rentals</h1>
      {orders.length === 0 ? (
        <p className="mt-3 text-[15px]">Nothing booked with this account yet.</p>
      ) : (
        <ul className="mt-3">
          {orders.map((o) => (
            <li key={o.id} className="border-b border-[color:var(--hire-line)]">
              <Link href={`/hire/o/${o.access_token}`} className="flex min-h-[60px] items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-[color:var(--hire-ink)]">
                    {o.purpose ?? rangeLabel(o.starts_on, o.ends_on)}
                  </span>
                  <span className="block text-[12px] text-[color:var(--hire-muted)]">
                    {o.number}
                    {o.purpose ? ` · ${rangeLabel(o.starts_on, o.ends_on)}` : ""}
                    {o.kind === "internal" ? " · internal" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[13px]">{STATUS[o.status] ?? o.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
