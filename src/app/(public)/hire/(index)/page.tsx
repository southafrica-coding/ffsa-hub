// Storefront home (frames 44b, 47a-1): pick dates, then browse what's free.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import { rangeLabel, readRange, sastToday } from "@/lib/equipment/dates";
import { categoryIds, loadStore, withDates } from "@/lib/equipment/storefront";
import { DateBar, ItemCard } from "../_components/store-ui";

export default async function HireHome({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = sastToday();
  const range = readRange(params, today);
  const supabase = await createClient();
  const [{ items, categories }, { data: auth }] = await Promise.all([
    loadStore(supabase, range),
    supabase.auth.getUser(),
  ]);

  const shown = items.filter((i) => !i.isKit).slice(0, 8);
  const kits = items.filter((i) => i.isKit);
  const categoryCards = categories.map((c) => {
    const ids = categoryIds(c);
    const inCat = items.filter((i) => i.categoryId && ids.has(i.categoryId));
    return { cat: c, total: inCat.length, free: inCat.filter((i) => i.free > 0).length };
  });

  return (
    <main>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-[color:var(--hire-line)] bg-[radial-gradient(120%_90%_at_85%_10%,#2A2316_0%,#100E0B_60%)]">
        <div className="flex max-w-[820px] flex-col gap-4 px-[18px] pb-6 pt-10 md:gap-6 md:px-14 md:pb-16 md:pt-24">
          <div className="hidden text-[13px] font-medium uppercase tracking-[0.22em] text-[color:var(--hire-accent)] md:block">
            {categories.map((c) => c.name).join(" · ") || "Sound · Screens · Stage"}
          </div>
          <h1 className="hire-display text-[68px] leading-[0.86] md:text-[150px]">
            When do you
            <br />
            need it?
          </h1>
          <p className="hidden max-w-[520px] text-[18px] leading-relaxed md:block">
            Pick your dates and we only show you what is free. Collect from us at the base in Potchefstroom.
          </p>
          <DateBar action="/hire/c/all" range={range} today={today} className="md:max-w-[640px]" />
        </div>
      </section>

      {!auth.user && (
        <div className="mx-[18px] mt-4 flex flex-col gap-2 rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface)] px-4 py-3.5 text-[14px] md:mx-10 md:flex-row md:items-center md:justify-between md:px-5">
          <span>
            <b className="text-[color:var(--hire-ink)]">Booking for a ministry wing?</b> Sign in with your Hub account to see internal
            rates. Internal bookings go to the rental manager for approval.
          </span>
          <Link href="/login?redirect=/hire" className="shrink-0 font-bold text-[color:var(--hire-accent)]">
            Sign in →
          </Link>
        </div>
      )}

      {items.length === 0 ? (
        <section className="px-[18px] py-14 md:px-10">
          <h2 className="hire-display text-[52px] md:text-[72px]">Nothing on the store yet</h2>
          <p className="mt-3 max-w-[520px] text-[16px] leading-relaxed">
            We&apos;re still pricing our gear and taking photos. Check back soon, or ask the base office what&apos;s available.
          </p>
        </section>
      ) : (
        <>
          {/* ── Browse ── */}
          <section className="px-[18px] pt-6 md:px-10 md:pt-14">
            <div className="mb-3 flex items-baseline justify-between md:mb-5">
              <h2 className="hire-display text-[30px] md:text-[52px]">Browse</h2>
              <span className="text-[13px] text-[color:var(--hire-muted)]">Free on {rangeLabel(range.from, range.to)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4">
              {categoryCards.map(({ cat, total, free }) =>
                total > 0 ? (
                  <Link
                    key={cat.id}
                    href={withDates(`/hire/c/${cat.slug}`, range)}
                    className="flex min-h-[76px] flex-col justify-between rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-surface2)] p-3 hover:border-[color:var(--hire-line-strong)] md:h-[180px] md:p-5"
                  >
                    <span className="hire-display text-[24px] md:text-[40px]">{cat.name}</span>
                    <span className={cn("text-[12px] md:text-[13px]", free < total ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ok)]")}>
                      {free} of {total} {total === 1 ? "item" : "items"} free
                    </span>
                  </Link>
                ) : (
                  <Link
                    key={cat.id}
                    href={withDates(`/hire/c/${cat.slug}`, range)}
                    className="flex min-h-[76px] flex-col justify-between rounded-[8px] border border-dashed border-[color:var(--hire-line-strong)] p-3 md:h-[180px] md:p-5"
                  >
                    <span className="hire-display text-[24px] !text-[color:var(--hire-muted)] md:text-[40px]">{cat.name}</span>
                    <span className="text-[12px] text-[color:var(--hire-muted)] md:text-[13px]">Nothing listed yet</span>
                  </Link>
                )
              )}
              <Link
                href={withDates("/hire/c/all", range)}
                className="flex min-h-[76px] flex-col justify-between rounded-[8px] border border-[color:var(--hire-accent)] bg-[color:var(--hire-surface)] p-3 md:h-[180px] md:p-5"
              >
                <span className="hire-display text-[24px] !text-[color:var(--hire-accent)] md:text-[40px]">All gear</span>
                <span className="text-[12px] md:text-[13px]">
                  {items.filter((i) => i.free > 0).length} of {items.length} free
                </span>
              </Link>
            </div>
          </section>

          {/* ── On the store (free first) ── */}
          <section className="pt-6 md:px-10 md:pt-14">
            <div className="mb-1 flex items-baseline justify-between px-[18px] md:mb-5 md:px-0">
              <h2 className="hire-display text-[30px] md:text-[52px]">On the store</h2>
              <span className="hidden text-[13px] text-[color:var(--hire-muted)] md:inline">
                Prices excl. 15% VAT · deposit on checkout
              </span>
            </div>
            <div className="md:grid md:grid-cols-4 md:gap-5">
              {shown.map((i) => (
                <ItemCard key={i.id} item={i} range={range} />
              ))}
            </div>
          </section>

          {kits.length > 0 && (
            <section className="pt-6 md:px-10 md:pt-14">
              <h2 className="hire-display mb-1 px-[18px] text-[30px] md:mb-5 md:px-0 md:text-[52px]">
                Kits{" "}
                <span className="font-sans text-[15px] tracking-normal text-[color:var(--hire-muted)]">
                  Everything for one job in one booking
                </span>
              </h2>
              <div className="md:grid md:grid-cols-4 md:gap-5">
                {kits.map((i) => (
                  <ItemCard key={i.id} item={i} range={range} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <div className="h-10 md:h-16" />
    </main>
  );
}
