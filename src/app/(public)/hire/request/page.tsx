// The pick list: for people who already know what they need. Everything
// that's free on their dates, with a quantity on each, and one form to
// send the list to the team. The questions (/hire/helper) are a side link
// for anyone who isn't sure. Picks ride in ?pick=slug:qty,… so changing
// the dates, or arriving from an item page, keeps them.

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { rangeLabel, readRange, sastToday } from "@/lib/equipment/dates";
import { itemTitle, loadStore } from "@/lib/equipment/storefront";
import { listProducts, type EquipmentProduct } from "@/services/equipment";
import { PickList, type PickItem } from "./pick-list";

export const metadata: Metadata = {
  title: "Pick your gear · Hire · Fire & Fragrance",
  description: "Choose the sound gear you need from what's free on your dates and send the list to our team.",
};

/** "speaker-12:2,sm58:4" → { "speaker-12": 2, "sm58": 4 } */
function readPicks(raw: string | string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const s = Array.isArray(raw) ? raw[0] : raw;
  for (const part of (s ?? "").split(",").slice(0, 40)) {
    const [slug, n] = part.split(":");
    const qty = Number(n ?? 1);
    if (slug && /^[a-z0-9-]{1,120}$/.test(slug) && Number.isInteger(qty) && qty > 0) out[slug] = Math.min(qty, 100);
  }
  return out;
}

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; pick?: string }>;
}) {
  const sp = await searchParams;
  const today = sastToday();
  const range = readRange(sp, today);
  const supabase = await createClient();
  const [{ items, categories }, productsRes] = await Promise.all([
    loadStore(supabase, range),
    listProducts(supabase, { listedOnly: true }),
  ]);
  const products = new Map(((productsRes.data ?? []) as EquipmentProduct[]).map((p) => [p.id, p]));

  // Each item under its top-level category, in the store's order.
  const topOf = new Map<string, string>();
  for (const c of categories) {
    topOf.set(c.id, c.name);
    for (const child of c.children) topOf.set(child.id, c.name);
  }
  const pickItems: PickItem[] = items.map((i) => {
    const p = products.get(i.id);
    return {
      id: i.id,
      slug: i.slug,
      title: itemTitle(i),
      group: (i.categoryId && topOf.get(i.categoryId)) || "Other",
      photo: i.photo,
      free: i.free,
      max: p?.max_per_order ? Math.min(i.free, p.max_per_order) : i.free,
      priceCents: i.priceCents,
      periodText: i.periodText,
      depositCents: p?.deposit_cents ?? 0,
    };
  });

  return (
    <main className="px-[18px] pb-10 pt-8 md:px-14 md:pb-16 md:pt-14">
      <div className="hire-label mb-3">Hire</div>
      <h1 className="hire-display text-[52px] md:text-[96px]">Pick your gear</h1>
      <p className="mt-3 max-w-[620px] text-[16px] leading-relaxed md:text-[18px]">
        Choose what you need from what&apos;s free on your dates, then send us the list. The team will confirm it and
        email you a quote.
      </p>
      <div className="mt-6 md:mt-10">
        <PickList
          key={`${range.from}-${range.to}`}
          items={pickItems}
          today={today}
          from={range.from}
          to={range.to}
          datesChosen={range.chosen}
          rangeText={rangeLabel(range.from, range.to)}
          initialPicks={readPicks(sp.pick)}
        />
      </div>
    </main>
  );
}
