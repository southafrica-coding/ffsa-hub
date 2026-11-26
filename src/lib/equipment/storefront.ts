// Data for the public storefront (/hire). Everything is read through the
// visitor's own client: RLS shows only listed products and visible
// categories, and the SECURITY DEFINER availability functions give counts
// without exposing units or orders.

import {
  freeCountForKit,
  freeFrom,
  getEquipmentSettings,
  listCategories,
  listProductPhotos,
  listProducts,
  listedAvailability,
  type EquipmentCategory,
  type EquipmentProduct,
  type EquipmentProductPhoto,
  type EquipmentSettings,
} from "@/services/equipment";
import { addDays } from "./dates";
import { photoUrl } from "./photos";
import { periodLabel, quote, type QuoteSettings } from "./pricing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type StoreItem = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  model: string | null;
  categoryId: string | null;
  isKit: boolean;
  /** Bookable units (or whole kits) that exist at all. */
  stock: number;
  /** Free on the worst day of the chosen dates. */
  free: number;
  /** Price per unit for the chosen dates, on the cheapest period. */
  priceCents: number;
  periodText: string;
  photo: string | null;
  /** For booked items: the first day one is free again. */
  freeFrom: string | null;
  /**
   * False for gear that's on show but can't be hired: it stays in the
   * building, or every unit is in a room that doesn't allow hire
   * (migration 400). Shown greyed out; it can never be picked.
   */
  forHire: boolean;
};

/** For hire: allowed out, and at least one unit in a room that allows hire. */
export function isForHire(p: { can_leave_building: boolean }, stock: number): boolean {
  return p.can_leave_building && stock > 0;
}

export type StoreCategory = EquipmentCategory & { children: EquipmentCategory[] };

export const DEFAULT_SETTINGS: QuoteSettings = { vat_bps: 1500, waiver_bps: 1000 };

/** Fully free first, then partly free, then booked, then not for hire; alphabetical within each. */
export function sortForStore<T extends { free: number; stock: number; name: string; forHire?: boolean }>(items: T[]): T[] {
  const rank = (i: T) =>
    i.forHire === false ? 3 : i.free > 0 && i.free >= i.stock ? 0 : i.free > 0 ? 1 : 2;
  return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** "Shure SM58" — what a card calls a product. */
export function itemTitle(i: { name: string; brand: string | null; model: string | null }): string {
  const make = [i.brand, i.model].filter(Boolean).join(" ");
  return make ? `${make} ${i.name.toLowerCase()}` : i.name;
}

export function categoryTree(categories: EquipmentCategory[]): StoreCategory[] {
  return categories
    .filter((c) => !c.parent_id)
    .map((c) => ({ ...c, children: categories.filter((x) => x.parent_id === c.id) }));
}

export async function loadStore(
  supabase: Client,
  range: { from: string; to: string },
  opts?: { withFreeFrom?: boolean }
): Promise<{
  items: StoreItem[];
  categories: StoreCategory[];
  settings: QuoteSettings;
  error: string | null;
}> {
  const [productsRes, catsRes, settingsRes, avail] = await Promise.all([
    listProducts(supabase, { listedOnly: true }),
    listCategories(supabase, { visibleOnly: true }),
    getEquipmentSettings(supabase),
    listedAvailability(supabase, range.from, range.to),
  ]);
  const error = productsRes.error?.message ?? avail.error?.message ?? null;
  const products = (productsRes.data ?? []) as EquipmentProduct[];
  const settings = (settingsRes.data as EquipmentSettings | null) ?? DEFAULT_SETTINGS;

  const { data: photoRows } = await listProductPhotos(
    supabase,
    products.map((p) => p.id)
  );
  const firstPhoto = new Map<string, string>();
  for (const ph of (photoRows ?? []) as EquipmentProductPhoto[]) {
    if (!firstPhoto.has(ph.product_id)) firstPhoto.set(ph.product_id, photoUrl(ph.file_path));
  }

  const items: StoreItem[] = await Promise.all(
    products.map(async (p) => {
      let stock = 0;
      let free = 0;
      if (p.is_kit) {
        const kit = await freeCountForKit(supabase, p.id, range.from, range.to);
        free = kit.data?.free ?? 0;
        stock = free; // a kit's "stock" is whatever its parts allow
      } else {
        const a = avail.data.get(p.id);
        stock = a?.stock ?? 0;
        free = a?.free ?? 0;
      }
      const q = quote([{ product: p, quantity: 1 }], range.from, range.to, "external", settings);
      const line = q.lines[0];
      // A kit's stock is only what its parts allow today, so don't read it as "not for hire".
      const forHire = p.is_kit ? p.can_leave_building : isForHire(p, stock);
      const nextFree =
        opts?.withFreeFrom && forHire && free === 0 && stock > 0
          ? (await freeFrom(supabase, p.id, addDays(range.to, 1))).data
          : null;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        model: p.model,
        categoryId: p.store_category_id,
        isKit: p.is_kit,
        stock,
        free,
        priceCents: line.unitPriceCents,
        periodText: periodLabel(line.period, q.days),
        photo: firstPhoto.get(p.id) ?? null,
        freeFrom: nextFree,
        forHire,
      };
    })
  );

  return {
    items: sortForStore(items),
    categories: categoryTree((catsRes.data ?? []) as EquipmentCategory[]),
    settings: { vat_bps: settings.vat_bps, waiver_bps: settings.waiver_bps },
    error,
  };
}

/** A category and every child under it. */
export function categoryIds(cat: StoreCategory): Set<string> {
  return new Set([cat.id, ...cat.children.map((c) => c.id)]);
}

/** Keep the chosen dates on every storefront link. */
export function withDates(href: string, range: { from: string; to: string; chosen?: boolean }, extra?: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  sp.set("from", range.from);
  sp.set("to", range.to);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) sp.set(k, v);
  return `${href}?${sp.toString()}`;
}
