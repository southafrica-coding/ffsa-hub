// Server-side checkout helpers shared by /api/equipment/cart and
// /api/equipment/checkout: read and validate a cart, then price it against
// what's actually free. Never trusts a price or a count from the browser.

import {
  getEquipmentAccess,
  getEquipmentSettings,
  listProductPhotos,
  listProducts,
  listedAvailability,
  type EquipmentProduct,
  type EquipmentSettings,
} from "@/services/equipment";
import { dayCount, isIsoDate, sastToday } from "./dates";
import { lineFit, pickSwap, type CartLine, type LineFit } from "./cart";
import { photoUrl } from "./photos";
import { periodLabel, quote, type OrderKind, type Quote } from "./pricing";
import { DEFAULT_SETTINGS, itemTitle } from "./storefront";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type CheckedLine = {
  productId: string;
  slug: string;
  title: string;
  photo: string | null;
  quantity: number;
  free: number;
  stock: number;
  fit: LineFit;
  unitPriceCents: number;
  lineTotalCents: number;
  periodText: string;
  swap: { productId: string; title: string; unitPriceCents: number; free: number } | null;
};

export type CheckedCart = {
  kind: OrderKind;
  lines: CheckedLine[];
  /** Products that are gone from the store altogether. */
  missing: string[];
  /** Totals over the lines that fit. */
  quote: Quote;
  settled: boolean;
  settings: Pick<EquipmentSettings, "vat_bps" | "waiver_bps" | "waiver_cover_cents" | "deposit_refund_days" | "agreement_version" | "xero_item_code">;
};

/** Validate the dates and lines a browser sent. Returns an error in plain words. */
export function readCartInput(body: unknown): { from: string; to: string; lines: CartLine[] } | { error: string } {
  const b = (body ?? {}) as { from?: unknown; to?: unknown; lines?: unknown };
  const today = sastToday();
  if (!isIsoDate(b.from) || !isIsoDate(b.to)) return { error: "Pick a collect date and a return date." };
  if (b.from < today) return { error: "The collect date has passed. Pick new dates." };
  if (b.to < b.from) return { error: "The return date is before the collect date." };
  if (dayCount(b.from, b.to) > 90) return { error: "Hires can be up to 90 days." };
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { error: "Your cart is empty." };
  if (b.lines.length > 30) return { error: "That's more lines than one order can take." };
  const merged = new Map<string, number>();
  for (const l of b.lines as { productId?: unknown; quantity?: unknown }[]) {
    if (typeof l?.productId !== "string" || !/^[0-9a-f-]{36}$/.test(l.productId)) return { error: "Something in your cart isn't on the store." };
    if (typeof l.quantity !== "number" || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 500) {
      return { error: "Quantities must be whole numbers." };
    }
    merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
  }
  return { from: b.from, to: b.to, lines: [...merged].map(([productId, quantity]) => ({ productId, quantity })) };
}

/** Is this visitor a signed-in ministry booker (equipment.request)? */
export async function canBookInternally(supabase: Client): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const access = await getEquipmentAccess(supabase, user.id);
  return access.canRequest;
}

/**
 * Check every line against the chosen dates and price the ones that fit.
 * `supabase` may be the visitor's client: RLS shows only listed products.
 */
export async function checkCart(
  supabase: Client,
  input: { from: string; to: string; lines: CartLine[] },
  kind: OrderKind
): Promise<CheckedCart> {
  const [productsRes, settingsRes, avail] = await Promise.all([
    listProducts(supabase, { listedOnly: true }),
    getEquipmentSettings(supabase),
    listedAvailability(supabase, input.from, input.to),
  ]);
  const products = ((productsRes.data ?? []) as EquipmentProduct[]).filter((p) => !p.is_kit);
  const byId = new Map(products.map((p) => [p.id, p]));
  const settings = (settingsRes.data as EquipmentSettings | null) ?? {
    ...DEFAULT_SETTINGS,
    waiver_cover_cents: 500_000,
    deposit_refund_days: 3,
    agreement_version: "2026-11",
    xero_item_code: null,
  };
  const { data: photos } = await listProductPhotos(
    supabase,
    input.lines.map((l) => l.productId)
  );
  const firstPhoto = new Map<string, string>();
  for (const ph of (photos ?? []) as { product_id: string; file_path: string }[]) {
    if (!firstPhoto.has(ph.product_id)) firstPhoto.set(ph.product_id, photoUrl(ph.file_path));
  }

  const unitPrice = (p: EquipmentProduct) =>
    quote([{ product: p, quantity: 1 }], input.from, input.to, kind, settings).lines[0];
  const candidates = products.map((p) => ({
    id: p.id,
    categoryId: p.store_category_id,
    free: avail.data.get(p.id)?.free ?? 0,
    priceCents: unitPrice(p).unitPriceCents,
  }));

  const missing: string[] = [];
  const lines: CheckedLine[] = [];
  for (const l of input.lines) {
    const p = byId.get(l.productId);
    if (!p) {
      missing.push(l.productId);
      continue;
    }
    const a = avail.data.get(p.id) ?? { free: 0, stock: 0 };
    const priced = unitPrice(p);
    const fit = lineFit(l.quantity, a.free);
    const swapPick =
      fit === "fits"
        ? null
        : pickSwap({ id: p.id, categoryId: p.store_category_id, priceCents: priced.unitPriceCents }, l.quantity, candidates);
    const swapProduct = swapPick ? byId.get(swapPick.id) : undefined;
    lines.push({
      productId: p.id,
      slug: p.slug,
      title: itemTitle(p),
      photo: firstPhoto.get(p.id) ?? null,
      quantity: l.quantity,
      free: a.free,
      stock: a.stock,
      fit,
      unitPriceCents: priced.unitPriceCents,
      lineTotalCents: priced.unitPriceCents * l.quantity,
      periodText: periodLabel(priced.period, dayCount(input.from, input.to)),
      swap:
        swapPick && swapProduct
          ? { productId: swapPick.id, title: itemTitle(swapProduct), unitPriceCents: swapPick.priceCents, free: swapPick.free }
          : null,
    });
  }

  const fitting = lines.filter((l) => l.fit === "fits");
  const q = quote(
    fitting.map((l) => ({ product: byId.get(l.productId)!, quantity: l.quantity })),
    input.from,
    input.to,
    kind,
    settings
  );

  return {
    kind,
    lines,
    missing,
    quote: q,
    settled: lines.length > 0 && missing.length === 0 && fitting.length === lines.length,
    settings: {
      vat_bps: settings.vat_bps,
      waiver_bps: settings.waiver_bps,
      waiver_cover_cents: settings.waiver_cover_cents,
      deposit_refund_days: settings.deposit_refund_days,
      agreement_version: settings.agreement_version,
      xero_item_code: settings.xero_item_code,
    },
  };
}
