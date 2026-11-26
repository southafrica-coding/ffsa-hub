// Test-only catalogue. Made-up products and example.org emails — never real
// buyers, never imported by app code, never in a migration.
import type { StoreProduct, StoreVariant } from "../types";

const base: Omit<StoreProduct, "id" | "slug" | "title" | "kind" | "price_cents"> = {
  subtitle: null,
  description: null,
  status: "published",
  currency: "ZAR",
  cover_image_url: null,
  subscription_months: null,
  ships: false,
  allow_delivery: false,
  allow_collect: false,
  delivery_fee_cents: 0,
  is_preorder: false,
  preorder_ships_on: null,
  allow_gift: true,
  allow_code_packs: false,
  sort_order: 100,
};

export const IDS = {
  review: "00000000-0000-4000-8000-000000000001",
  sub: "00000000-0000-4000-8000-000000000002",
  bundle: "00000000-0000-4000-8000-000000000003",
  tee: "00000000-0000-4000-8000-000000000004",
  hoodie: "00000000-0000-4000-8000-000000000005",
  draft: "00000000-0000-4000-8000-000000000006",
  teeS: "00000000-0000-4000-8000-0000000000a1",
  teeM: "00000000-0000-4000-8000-0000000000a2",
  teeL: "00000000-0000-4000-8000-0000000000a3",
};

export const review: StoreProduct = { ...base, id: IDS.review, slug: "example-review", title: "Example Review", kind: "digital", price_cents: 15000, allow_code_packs: true };
export const sub: StoreProduct = { ...base, id: IDS.sub, slug: "example-yearly", title: "Example Yearly", kind: "subscription", price_cents: 40000, subscription_months: 12 };
export const bundle: StoreProduct = { ...base, id: IDS.bundle, slug: "example-print-digital", title: "Example Print + Digital", kind: "bundle", price_cents: 35000, ships: true, allow_delivery: true, allow_collect: true, delivery_fee_cents: 9900, allow_gift: false };
export const tee: StoreProduct = { ...base, id: IDS.tee, slug: "example-tee", title: "Example Tee", kind: "physical", price_cents: 25000, ships: true, allow_collect: true, allow_delivery: true, delivery_fee_cents: 6500, allow_gift: false };
export const hoodie: StoreProduct = { ...base, id: IDS.hoodie, slug: "example-hoodie", title: "Example Hoodie", kind: "physical", price_cents: 55000, ships: true, allow_collect: true, allow_delivery: false, is_preorder: true, preorder_ships_on: "2027-02-01", allow_gift: false };
export const draft: StoreProduct = { ...base, id: IDS.draft, slug: "example-draft", title: "Example Draft", kind: "digital", price_cents: 1000, status: "draft" };

export const variants: StoreVariant[] = [
  { id: IDS.teeS, product_id: IDS.tee, label: "S", sku: null, price_cents: null, stock: 0, active: true, sort_order: 1 },
  { id: IDS.teeM, product_id: IDS.tee, label: "M", sku: null, price_cents: null, stock: 3, active: true, sort_order: 2 },
  { id: IDS.teeL, product_id: IDS.tee, label: "L", sku: null, price_cents: 27500, stock: null, active: true, sort_order: 3 },
];

export const catalogue = { products: [review, sub, bundle, tee, hoodie, draft], variants };

export const ADDRESS = { line1: "1 Example Street", city: "Exampleton", province: "North West", postal_code: "2531" };
