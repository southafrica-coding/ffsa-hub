// ============================================================
// Store — product input rules (catalogue as data)
// ============================================================
// Staff create and edit products in /store/admin. This validates and
// normalises what the admin form sends before it reaches the service.
// ============================================================

import { z } from "zod";
import type { ProductKind, StoreProduct } from "./types";

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const kind = z.enum(["digital", "subscription", "physical", "bundle"]);

export const productInputSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(160),
  slug: z.string().trim().optional(),
  subtitle: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(8000).optional().nullable(),
  kind,
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  price_cents: z.number().int().min(0).max(10_000_000),
  cover_image_url: z.string().trim().max(500).optional().nullable(),
  subscription_months: z.number().int().min(1).max(36).optional().nullable(),
  allow_delivery: z.boolean().default(false),
  allow_collect: z.boolean().default(false),
  delivery_fee_cents: z.number().int().min(0).max(1_000_000).default(0),
  is_preorder: z.boolean().default(false),
  preorder_ships_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  allow_gift: z.boolean().default(true),
  allow_code_packs: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(10_000).default(100),
});

export type ProductInput = z.input<typeof productInputSchema>;

/** Products with a print or physical side ship; digital-only never do. */
export function kindShips(k: ProductKind): boolean {
  return k === "physical" || k === "bundle";
}

/** Products with a flipbook. */
export function kindHasFlipbook(k: ProductKind): boolean {
  return k === "digital" || k === "subscription" || k === "bundle";
}

/** Only Print + Digital buyers get the watermarked PDF. */
export function kindIncludesPdf(k: ProductKind): boolean {
  return k === "bundle";
}

export type ProductRow = Omit<StoreProduct, "id" | "created_at" | "updated_at" | "currency">;

export function normaliseProductInput(
  raw: unknown
): { ok: true; row: ProductRow } | { ok: false; error: string } {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the product details" };
  }
  const p = parsed.data;
  const slug = slugify(p.slug?.length ? p.slug : p.title);
  if (!slug) return { ok: false, error: "The link name needs at least one letter or number" };

  const ships = kindShips(p.kind);
  if (ships && !p.allow_delivery && !p.allow_collect) {
    return { ok: false, error: "Choose delivery, collect at base, or both" };
  }
  if (p.kind === "subscription" && !p.subscription_months) {
    return { ok: false, error: "A subscription needs a length (12 months for yearly)" };
  }
  if (p.is_preorder && !ships) {
    return { ok: false, error: "Only products that ship can be preorders" };
  }

  return {
    ok: true,
    row: {
      slug,
      title: p.title,
      subtitle: p.subtitle || null,
      description: p.description || null,
      kind: p.kind,
      status: p.status,
      price_cents: p.price_cents,
      cover_image_url: p.cover_image_url || null,
      subscription_months: p.kind === "subscription" ? (p.subscription_months ?? 12) : null,
      ships,
      allow_delivery: ships && p.allow_delivery,
      allow_collect: ships && p.allow_collect,
      delivery_fee_cents: ships && p.allow_delivery ? p.delivery_fee_cents : 0,
      is_preorder: ships && p.is_preorder,
      preorder_ships_on: ships && p.is_preorder ? (p.preorder_ships_on ?? null) : null,
      allow_gift: p.allow_gift,
      // Code packs only make sense for something read in the library.
      allow_code_packs: kindHasFlipbook(p.kind) && p.allow_code_packs,
      sort_order: p.sort_order,
    },
  };
}

export function kindLabel(k: ProductKind): string {
  return { digital: "Digital", subscription: "Yearly subscription", physical: "Merch", bundle: "Print + Digital" }[k];
}
