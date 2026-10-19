// One item (frames 46b, 47a-3): photos, the three prices, the booking box,
// what's included, specs, and a month calendar of how many are free each
// day (equipment_free_by_day). A phone gets a week strip and a bottom bar.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import {
  freeByDay,
  freeCount,
  freeFrom,
  getEquipmentSettings,
  getProductBySlug,
  hasEquipmentAccess,
  listCategories,
  listProductPhotos,
  listRelatedIds,
  listUnits,
  listedAvailability,
  type EquipmentCategory,
  type EquipmentProductPhoto,
  type EquipmentProductWithRefs,
  type EquipmentSettings,
} from "@/services/equipment";
import {
  addDays,
  dayCount,
  dayLabel,
  monthGrid,
  monthLabel,
  monthOf,
  rangeLabel,
  readRange,
  sastToday,
  shiftMonth,
  weekday,
} from "@/lib/equipment/dates";
import { photoUrl } from "@/lib/equipment/photos";
import { randsShort } from "@/lib/equipment/money";
import { periodForDates } from "@/lib/equipment/pricing";
import { DEFAULT_SETTINGS, loadStore, withDates } from "@/lib/equipment/storefront";
import { DateBar, ItemCard, Photo } from "../../_components/store-ui";
import { ItemBooking } from "./item-booking";
import { canBookInternally } from "@/lib/equipment/checkout-server";

type Search = { from?: string; to?: string; month?: string; photo?: string };

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await getProductBySlug(supabase, slug);
  if (!data) return {};
  const make = [data.brand, data.model].filter(Boolean).join(" ");
  return { title: `${make ? `${make} ${data.name.toLowerCase()}` : data.name} · Hire · Fire & Fragrance` };
}

const WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const SHORT_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const today = sastToday();
  const range = readRange(sp, today);
  const supabase = await createClient();

  const { data: productData } = await getProductBySlug(supabase, slug);
  if (!productData) notFound();
  const product = productData as EquipmentProductWithRefs;
  const staff = await hasEquipmentAccess(supabase);
  const internalRate = await canBookInternally(supabase);
  // RLS already hides unlisted products from the public; staff may preview.
  if (!product.is_listed && !staff) notFound();

  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : monthOf(range.from);
  const grid = monthGrid(month);
  const stripStart = addDays(range.from, -1);
  const calFrom = grid[0] < stripStart ? grid[0] : stripStart;
  const calTo = grid[41] > addDays(stripStart, 6) ? grid[41] : addDays(stripStart, 6);

  const [photosRes, settingsRes, freeRes, availRes, daysRes, catsRes] = await Promise.all([
    listProductPhotos(supabase, [product.id]),
    getEquipmentSettings(supabase),
    freeCount(supabase, product.id, range.from, range.to),
    listedAvailability(supabase, range.from, range.to),
    freeByDay(supabase, product.id, calFrom, calTo),
    listCategories(supabase, { visibleOnly: true }),
  ]);

  const settings = (settingsRes.data as EquipmentSettings | null) ?? DEFAULT_SETTINGS;
  const photos = ((photosRes.data ?? []) as EquipmentProductPhoto[]).map((p) => photoUrl(p.file_path));
  const photoIndex = Math.min(Math.max(Number(sp.photo) || 0, 0), Math.max(photos.length - 1, 0));
  const free = freeRes.data ?? 0;
  let stock = availRes.data.get(product.id)?.stock ?? 0;
  if (!product.is_listed && staff) {
    const { data: units } = await listUnits(supabase, { productId: product.id });
    stock = ((units ?? []) as { status: string }[]).filter((u) => u.status === "available").length;
  }
  const perDay = new Map(((daysRes.data ?? []) as { day: string; free: number }[]).map((d) => [d.day, d.free]));

  const allFreeFromIso = free < stock ? (await freeFrom(supabase, product.id, addDays(range.to, 1), stock)).data : null;
  const freeAgainIso = free === 0 && stock > 0 ? (await freeFrom(supabase, product.id, addDays(range.to, 1))).data : null;

  const cats = (catsRes.data ?? []) as EquipmentCategory[];
  const cat = cats.find((c) => c.id === product.store_category_id);
  const parent = cat?.parent_id ? cats.find((c) => c.id === cat.parent_id) : undefined;

  // Frequently rented with: the hand-picked related products that are listed.
  const { data: relRows } = await listRelatedIds(supabase, product.id);
  const relatedIds = new Set(((relRows ?? []) as { related_id: string }[]).map((r) => r.related_id));
  const related = relatedIds.size ? (await loadStore(supabase, range)).items.filter((i) => relatedIds.has(i.id)).slice(0, 3) : [];

  const period = periodForDates(range.from, range.to);
  const days = dayCount(range.from, range.to);
  const rangeText = `${dayLabel(range.from)} → ${dayLabel(range.to)}`;
  const heading = product.model ?? product.name;
  const kicker = [product.model ? product.name : null, product.brand].filter(Boolean).join(" · ");
  const prices = [
    { key: "day", label: "Day", cents: product.price_day_cents, on: period === "day" },
    { key: "weekend", label: "Weekend · Fri–Mon", short: "Weekend", cents: product.price_weekend_cents, on: period === "weekend" },
    { key: "week", label: "Week", cents: product.price_week_cents, on: period === "week" },
  ].filter((p) => p.cents != null);

  const quoteProduct = {
    id: product.id,
    price_day_cents: product.price_day_cents,
    price_weekend_cents: product.price_weekend_cents,
    price_week_cents: product.price_week_cents,
    deposit_cents: product.deposit_cents,
    internal_day_cents: product.internal_day_cents,
  };
  const qSettings = { vat_bps: settings.vat_bps, waiver_bps: settings.waiver_bps };
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const monthHref = (m: string) => withDates(`/hire/p/${product.slug}`, range, { month: m });

  return (
    <main className="pb-[120px] md:pb-12">
      {!product.is_listed && (
        <div className="bg-[color:var(--hire-accent)] px-[18px] py-2.5 text-[14px] text-[color:var(--hire-on-accent)] md:px-10">
          <b>Not on the store.</b> Only staff can see this page.{" "}
          <Link href={`/bookings/equipment/gear/products/${product.id}`} className="underline">
            Edit the listing
          </Link>
        </div>
      )}

      <div className="hidden px-10 pt-5 text-[13px] text-[color:var(--hire-muted)] md:block">
        <Link href={withDates("/hire", range)} className="hover:underline">
          Hire
        </Link>
        {parent && (
          <>
            {" / "}
            <Link href={withDates(`/hire/c/${parent.slug}`, range)} className="hover:underline">
              {parent.name}
            </Link>
          </>
        )}
        {cat && (
          <>
            {" / "}
            <Link href={withDates(`/hire/c/${cat.slug}`, range)} className="hover:underline">
              {cat.name}
            </Link>
          </>
        )}
      </div>

      <div className="md:grid md:grid-cols-[minmax(0,1fr)_480px] md:gap-12 md:px-10 md:pt-5 lg:grid-cols-[minmax(0,1fr)_520px]">
        {/* Photos */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Photo src={photos[photoIndex] ?? null} alt={heading} className="h-[290px] md:h-[520px] md:rounded-[8px]" />
            <Link
              href={withDates(cat ? `/hire/c/${cat.slug}` : "/hire/c/all", range)}
              aria-label="Back"
              className="absolute left-3.5 top-3 flex h-11 w-11 items-center justify-center rounded-[999px] bg-[rgba(16,14,11,0.75)] text-[color:var(--hire-ink)] md:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            {photos.length > 1 && (
              <span className="absolute bottom-3 right-3.5 rounded-[999px] bg-[rgba(16,14,11,0.75)] px-2.5 py-1 text-[12px] text-[color:var(--hire-ink)] md:hidden">
                {photoIndex + 1} / {photos.length}
              </span>
            )}
          </div>
          {photos.length > 1 && (
            <div className="hidden grid-cols-4 gap-3 md:grid">
              {photos.slice(0, 8).map((src, i) => (
                <Link
                  key={src}
                  href={withDates(`/hire/p/${product.slug}`, range, { photo: String(i), month: sp.month })}
                  scroll={false}
                  className={cn("overflow-hidden rounded-[6px]", i === photoIndex && "outline outline-2 outline-[color:var(--hire-accent)]")}
                >
                  <Photo src={src} alt="" className="h-[110px]" />
                </Link>
              ))}
            </div>
          )}
          {photos.length > 1 && (
            <div className="-mt-1 flex gap-2 overflow-x-auto px-[18px] md:hidden">
              {photos.map((src, i) => (
                <Link
                  key={src}
                  href={withDates(`/hire/p/${product.slug}`, range, { photo: String(i), month: sp.month })}
                  scroll={false}
                  className={cn("shrink-0 overflow-hidden rounded-[4px]", i === photoIndex && "outline outline-2 outline-[color:var(--hire-accent)]")}
                >
                  <Photo src={src} alt="" className="h-14 w-14" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Details + booking */}
        <div className="flex flex-col gap-4 px-[18px] pt-4 md:gap-[22px] md:px-0 md:pt-0">
          <div>
            {kicker && <div className="text-[12px] uppercase tracking-[0.14em] text-[color:var(--hire-muted)]">{kicker}</div>}
            <h1 className="hire-display mt-1 text-[56px] md:mt-1.5 md:text-[84px]">{heading}</h1>
            {product.description && <p className="mt-3 text-[15px] leading-relaxed">{product.description}</p>}
          </div>

          {prices.length > 0 && (
            <div
              className="grid gap-[2px] overflow-hidden rounded-[8px] border border-[color:var(--hire-line2)] bg-[color:var(--hire-line2)]"
              style={{ gridTemplateColumns: `repeat(${prices.length}, minmax(0, 1fr))` }}>
              {prices.map((p) => (
                <div
                  key={p.key}
                  className={cn(
                    "px-2.5 py-2 md:px-3.5 md:py-3",
                    p.on ? "bg-[#2A2316] shadow-[inset_0_0_0_1px_var(--hire-accent)]" : "bg-[color:var(--hire-surface)]"
                  )}
                >
                  <div className={cn("text-[11px] md:text-[12px]", p.on ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-muted)]")}>
                    <span className="md:hidden">{p.short ?? p.label}</span>
                    <span className="hidden md:inline">{p.label}</span>
                  </div>
                  <div className={cn("hire-display text-[24px] md:text-[30px]", p.on && "!text-[color:var(--hire-accent)]")}>
                    {randsShort(p.cents!)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Phone: dates + a week strip (47a-3). */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex justify-between text-[14px]">
              <span className="text-[color:var(--hire-ink)]">{rangeLabel(range.from, range.to)}</span>
              <span className={free === 0 ? "text-[color:var(--hire-ink)]" : free < stock ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ok)]"}>
                {free === 0 ? "Booked" : free < stock ? `${free} of ${stock} free` : `${free} free`}
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, i) => addDays(stripStart, i)).map((d) => {
                const n = perDay.get(d);
                const sel = inRange(d);
                return (
                  <div
                    key={d}
                    className={cn(
                      "min-h-[56px] rounded-[5px] p-[5px] leading-tight",
                      sel ? "bg-[color:var(--hire-accent)] text-[color:var(--hire-on-accent)]" : "border border-[color:var(--hire-line2)]"
                    )}
                  >
                    <div className={cn("text-[10px]", !sel && "text-[color:var(--hire-muted)]")}>{SHORT_DAY[weekday(d)]}</div>
                    <div className={cn("text-[14px] font-bold", !sel && "text-[color:var(--hire-ink)]")}>{Number(d.slice(8))}</div>
                    <div className={cn("text-[10px]", !sel && (n === 0 ? "text-[color:var(--hire-dim)]" : "text-[color:var(--hire-muted)]"))}>
                      {n == null ? "" : n === 0 ? "—" : n}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="hidden md:block">
            <ItemBooking
              slug={product.slug}
              variant="box"
              product={quoteProduct}
              settings={qSettings}
              from={range.from}
              to={range.to}
              free={free}
              stock={stock}
              rangeText={rangeText}
              allFreeFrom={allFreeFromIso ? dayLabel(allFreeFromIso) : null}
              internalRate={internalRate}
            />
          </div>
          {free === 0 && freeAgainIso && (
            <p className="text-[14px] text-[color:var(--hire-ink)]">
              Booked on your dates.{" "}
              <Link
                href={withDates(`/hire/p/${product.slug}`, { from: freeAgainIso, to: addDays(freeAgainIso, days - 1) })}
                className="underline underline-offset-4"
              >
                Free from {dayLabel(freeAgainIso)}
              </Link>
            </p>
          )}
          <div id="dates" className="scroll-mt-20">
            <div className="hire-label mb-2">Change your dates</div>
            <DateBar action={`/hire/p/${product.slug}`} range={range} today={today} submitLabel="Check these dates" />
          </div>
          {!internalRate && (
            <p className="text-[13px]">
              <b className="text-[color:var(--hire-ink)]">Booking for a ministry wing?</b>{" "}
              <Link href={`/login?redirect=${encodeURIComponent(`/hire/p/${product.slug}`)}`} className="underline underline-offset-4">
                Sign in
              </Link>{" "}
              to see your internal rate.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 md:mt-12 md:grid md:grid-cols-[minmax(0,1fr)_480px] md:gap-12 md:px-10 lg:grid-cols-[minmax(0,1fr)_560px]">
        <div className="flex flex-col gap-7 px-[18px] md:px-0">
          {(product.included?.length > 0 || Object.keys(product.specs ?? {}).length > 0) && (
            <div className="grid gap-7 md:grid-cols-2 md:gap-8">
              {product.included?.length > 0 && (
                <div>
                  <div className="hire-display mb-2 text-[30px]">What&apos;s included</div>
                  <ul className="text-[14px] leading-[1.9]">
                    {product.included.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Object.keys(product.specs ?? {}).length > 0 && (
                <div>
                  <div className="hire-display mb-2 text-[30px]">Specs</div>
                  <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[14px]">
                    {Object.entries(product.specs).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-[color:var(--hire-muted)]">{k}</dt>
                        <dd className="text-[color:var(--hire-ink)]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}
          {related.length > 0 && (
            <div>
              <div className="hire-display mb-3 text-[30px]">Frequently rented with</div>
              <div className="-mx-[18px] md:mx-0 md:grid md:grid-cols-3 md:gap-3.5">
                {related.map((i) => (
                  <ItemCard key={i.id} item={i} range={range} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Month calendar (46b) — desktop. */}
        <div className="hidden md:block">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="hire-display text-[30px]">{monthLabel(month)}</span>
            <span className="flex gap-3 text-[13px] text-[color:var(--hire-muted)]">
              <Link href={monthHref(shiftMonth(month, -1))} scroll={false} className="hover:text-[color:var(--hire-ink)]">
                ‹ {monthLabel(shiftMonth(month, -1)).slice(0, 3)}
              </Link>
              ·
              <Link href={monthHref(shiftMonth(month, 1))} scroll={false} className="hover:text-[color:var(--hire-ink)]">
                {monthLabel(shiftMonth(month, 1)).slice(0, 3)} ›
              </Link>
            </span>
          </div>
          <div className="mb-1.5 grid grid-cols-7 gap-1 text-[11px] tracking-[0.12em] text-[color:var(--hire-muted)]">
            {WEEK.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((d) => {
              const n = perDay.get(d);
              const outside = monthOf(d) !== month;
              const past = d < today;
              const sel = inRange(d);
              const booked = n === 0;
              return (
                <div
                  key={d}
                  className={cn(
                    "flex h-[58px] flex-col justify-between rounded-[5px] border px-2 py-1.5",
                    sel
                      ? "border-[color:var(--hire-accent)] bg-[color:var(--hire-accent)]"
                      : booked
                        ? "border-[color:var(--hire-line2)]"
                        : "border-[color:var(--hire-line2)] bg-[color:var(--hire-surface2)]",
                    (outside || past) && !sel && "opacity-35"
                  )}
                >
                  <span
                    className={cn(
                      "text-[15px] font-bold",
                      sel ? "text-[color:var(--hire-on-accent)]" : booked ? "text-[color:var(--hire-dim)]" : "text-[color:var(--hire-ink)]"
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <span
                    className={cn(
                      "text-[10px]",
                      sel
                        ? "text-[color:var(--hire-on-accent)]"
                        : booked
                          ? "text-[color:var(--hire-dim)]"
                          : n != null && n < stock
                            ? "text-[color:var(--hire-accent)]"
                            : "text-[color:var(--hire-muted)]"
                    )}
                  >
                    {n == null || past ? "" : booked ? "BOOKED" : `${n} free`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-[18px] text-[12px] text-[color:var(--hire-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-[color:var(--hire-accent)]" />
              Your dates
            </span>
            <span>Amber number: some out</span>
            <span>Booked: none free</span>
          </div>
        </div>
      </div>

      {/* Phone: the main action in a bar at the bottom (47a). */}
      <div
        className="fixed inset-x-0 z-30 border-t border-[color:var(--hire-line)] bg-[color:var(--hire-surface)] px-[18px] py-3 md:hidden"
        style={{ bottom: "calc(58px + max(10px, env(safe-area-inset-bottom, 0px)))" }}
      >
        <ItemBooking
          slug={product.slug}
          variant="bar"
          product={quoteProduct}
          settings={qSettings}
          from={range.from}
          to={range.to}
          free={free}
          stock={stock}
          rangeText={rangeText}
          allFreeFrom={allFreeFromIso ? dayLabel(allFreeFromIso) : null}
              internalRate={internalRate}
        />
      </div>
    </main>
  );
}

