// A category, filtered to your dates (frames 46a, 47a-2, empty: 46e left).
// Free first, then partly free, then booked with "free from <date>".
// /hire/c/all is every listed product, and takes ?q= from the header search.

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";
import { dayCount, rangeLabel, readRange, sastToday } from "@/lib/equipment/dates";
import { periodForDates, periodLabel } from "@/lib/equipment/pricing";
import { categoryIds, loadStore, withDates, type StoreCategory } from "@/lib/equipment/storefront";
import { DateBar, ItemCard } from "../../_components/store-ui";

type Params = { from?: string; to?: string; only?: string; type?: string; q?: string };

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Params>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const today = sastToday();
  const range = readRange(sp, today);
  const supabase = await createClient();
  const { items, categories } = await loadStore(supabase, range, { withFreeFrom: true });

  const all = slug === "all";
  const cat: StoreCategory | undefined = all ? undefined : categories.find((c) => c.slug === slug);
  // A child slug (e.g. /hire/c/microphones) shows its parent with that type picked.
  const parentOfChild = all || cat ? undefined : categories.find((c) => c.children.some((x) => x.slug === slug));
  if (!all && !cat && !parentOfChild) notFound();
  const category = cat ?? parentOfChild;
  const typeSlug = parentOfChild ? slug : sp.type;
  const type = category?.children.find((c) => c.slug === typeSlug);

  const q = (sp.q ?? "").trim().toLowerCase();
  const onlyFree = sp.only === "free";

  const inScope = items.filter((i) => {
    if (category) {
      const ids = type ? new Set([type.id]) : categoryIds(category);
      if (!i.categoryId || !ids.has(i.categoryId)) return false;
    }
    if (q && ![i.name, i.brand, i.model].some((f) => f?.toLowerCase().includes(q))) return false;
    return true;
  });
  const shown = onlyFree ? inScope.filter((i) => i.free > 0) : inScope;
  const freeCount = inScope.filter((i) => i.free > 0).length;

  const title = all ? (q ? `“${sp.q!.trim()}”` : "All gear") : category!.name;
  const base = `/hire/c/${all ? "all" : category!.slug}`;
  const keep = { only: onlyFree ? "free" : undefined, type: type?.slug, q: sp.q };
  const href = (over: Partial<typeof keep>) => withDates(base, range, { ...keep, ...over });
  const periodText = periodLabel(periodForDates(range.from, range.to), dayCount(range.from, range.to));

  // Category counts for the type filter, before the type itself narrows them.
  const typeCounts = new Map<string, number>();
  for (const c of category?.children ?? []) {
    typeCounts.set(c.id, items.filter((i) => i.categoryId === c.id).length);
  }

  // Nothing listed here at all: say so plainly (46e left).
  const categoryEmpty = !!category && items.every((i) => !i.categoryId || !categoryIds(category).has(i.categoryId));
  if (categoryEmpty) {
    const other = categories.find((c) => c.id !== category!.id && items.some((i) => i.categoryId && categoryIds(c).has(i.categoryId)));
    return (
      <main className="px-[18px] py-12 md:px-12 md:py-20">
        <div className="text-[13px] text-[color:var(--hire-muted)]">Hire / {category!.name}</div>
        <h1 className="hire-display mt-2 text-[60px] md:text-[96px]">No {category!.name.toLowerCase()} yet</h1>
        <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed">
          Nothing in {category!.name.toLowerCase()} is on the store right now. We add gear as we price it.
        </p>
        <div className="mt-5 flex flex-col gap-2 text-[15px]">
          {other && (
            <Link href={withDates(`/hire/c/${other.slug}`, range)} className="text-[color:var(--hire-ink)] underline underline-offset-4">
              See what&apos;s in {other.name} instead
            </Link>
          )}
          <Link href={withDates("/hire/c/all", range)} className="text-[color:var(--hire-ink)] underline underline-offset-4">
            See all gear
          </Link>
        </div>
      </main>
    );
  }

  const chip = (on: boolean) =>
    cn(
      "flex h-11 shrink-0 items-center rounded-[999px] px-4 text-[13px]",
      on
        ? "bg-[color:var(--hire-accent)] font-bold text-[color:var(--hire-on-accent)]"
        : "border border-[color:var(--hire-line-strong)] text-[color:var(--hire-ink)]"
    );

  return (
    <main>
      <header className="flex flex-col gap-3 border-b border-[color:var(--hire-line)] px-[18px] pb-3 pt-3 md:flex-row md:items-end md:justify-between md:gap-6 md:px-10 md:pb-7 md:pt-9">
        <div>
          <div className="hidden text-[13px] text-[color:var(--hire-muted)] md:block">
            <Link href={withDates("/hire", range)} className="hover:underline">
              Hire
            </Link>{" "}
            / {title}
          </div>
          <div className="flex items-end justify-between gap-3">
            <h1 className="hire-display text-[52px] md:mt-1.5 md:text-[96px]">{title}</h1>
            <span className="pb-1.5 text-[13px] md:hidden">
              {freeCount} of {inScope.length} free
            </span>
          </div>
        </div>
        <DateBar
          action={base}
          range={range}
          today={today}
          hidden={keep}
          submitLabel="Update"
          periodText={periodText}
          className="md:min-w-[560px]"
        />
        {/* Phone filters: chips (47a-2). */}
        <div className="-mx-[18px] flex gap-2 overflow-x-auto px-[18px] md:hidden">
          <Link href={href({ only: onlyFree ? undefined : "free" })} className={chip(onlyFree)}>
            Free only
          </Link>
          {category?.children
            .filter((c) => (typeCounts.get(c.id) ?? 0) > 0)
            .map((c) => (
              <Link key={c.id} href={href({ type: type?.id === c.id ? undefined : c.slug })} className={chip(type?.id === c.id)}>
                {c.name}
              </Link>
            ))}
        </div>
      </header>

      <div className="md:grid md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Desktop filters (46a). */}
        <aside className="hidden flex-col gap-7 border-r border-[color:var(--hire-line)] py-7 pl-10 pr-7 md:flex">
          <Link href={href({ only: onlyFree ? undefined : "free" })} className="flex items-center justify-between text-[14px] font-medium text-[color:var(--hire-ink)]">
            Only free on my dates
            <span className={cn("relative h-[22px] w-[38px] rounded-[999px]", onlyFree ? "bg-[color:var(--hire-accent)]" : "bg-[color:var(--hire-line-strong)]")}>
              <span
                className={cn(
                  "absolute top-[3px] h-4 w-4 rounded-[999px]",
                  onlyFree ? "right-[3px] bg-[color:var(--hire-on-accent)]" : "left-[3px] bg-[color:var(--hire-muted)]"
                )}
              />
            </span>
          </Link>
          {category && category.children.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="hire-label">Type</div>
              <Link href={href({ type: undefined })} className="flex items-center gap-2.5 text-[14px] text-[color:var(--hire-ink)]">
                <span className={cn("h-4 w-4 rounded-[4px]", !type ? "bg-[color:var(--hire-accent)]" : "border border-[color:var(--hire-dim-edge)]")} />
                All {category.name.toLowerCase()}
              </Link>
              {category.children.map((c) => (
                <Link key={c.id} href={href({ type: c.slug })} className="flex items-center gap-2.5 text-[14px] text-[color:var(--hire-ink)]">
                  <span className={cn("h-4 w-4 rounded-[4px]", type?.id === c.id ? "bg-[color:var(--hire-accent)]" : "border border-[color:var(--hire-dim-edge)]")} />
                  {c.name}
                  <span className="ml-auto text-[color:var(--hire-muted)]">{typeCounts.get(c.id) ?? 0}</span>
                </Link>
              ))}
            </div>
          )}
          {all && categories.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="hire-label">Categories</div>
              {categories.map((c) => (
                <Link key={c.id} href={withDates(`/hire/c/${c.slug}`, range)} className="text-[14px] text-[color:var(--hire-ink)] hover:underline">
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </aside>

        <section className="md:px-10 md:pb-12 md:pt-6">
          <div className="mb-4 hidden items-baseline justify-between text-[14px] md:flex">
            <span>
              <b className="text-[color:var(--hire-ink)]">
                {inScope.length} {inScope.length === 1 ? "item" : "items"}
              </b>{" "}
              · {freeCount} free on {rangeLabel(range.from, range.to)}
            </span>
            <span>
              Sort: <b className="text-[color:var(--hire-ink)]">Free first</b>
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="px-[18px] py-10 text-[15px] md:px-0">
              {q
                ? `Nothing on the store matches “${sp.q!.trim()}”.`
                : onlyFree
                  ? `Nothing here is free on ${rangeLabel(range.from, range.to)}. Try other dates, or turn off “free only” to see when things come back.`
                  : "Nothing here yet."}
            </p>
          ) : (
            <div className="md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3">
              {shown.map((i) => (
                <ItemCard key={i.id} item={i} range={range} label={[i.name, i.brand].filter(Boolean).join(" · ")} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
