"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { slugify } from "@/lib/store/catalogue";
import { parseRandsToCents } from "@/lib/store/money";
import type { ProductKind, ProductStatus, StoreProduct } from "@/lib/store/types";

const KINDS: Array<{ id: ProductKind; label: string; hint: string }> = [
  { id: "digital", label: "Digital", hint: "Read in the browser flipbook. No download." },
  { id: "subscription", label: "Subscription", hint: "Flipbook access for a set time (12 months = yearly)." },
  { id: "bundle", label: "Print + Digital", hint: "Printed copy, the flipbook, and a low-res PDF." },
  { id: "physical", label: "Merch", hint: "Sizes, stock, delivery or collect at base." },
];

export function ProductForm({ product }: { product?: StoreProduct }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    subtitle: product?.subtitle ?? "",
    description: product?.description ?? "",
    kind: (product?.kind ?? "digital") as ProductKind,
    status: (product?.status ?? "draft") as ProductStatus,
    price: product ? String(product.price_cents / 100) : "",
    subscription_months: String(product?.subscription_months ?? 12),
    allow_delivery: product?.allow_delivery ?? false,
    allow_collect: product?.allow_collect ?? true,
    delivery_fee: product ? String(product.delivery_fee_cents / 100) : "0",
    is_preorder: product?.is_preorder ?? false,
    preorder_ships_on: product?.preorder_ships_on ?? "",
    allow_gift: product?.allow_gift ?? true,
    allow_code_packs: product?.allow_code_packs ?? false,
    sort_order: String(product?.sort_order ?? 100),
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const ships = f.kind === "physical" || f.kind === "bundle";
  const readable = f.kind !== "physical";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = parseRandsToCents(f.price);
    const fee = parseRandsToCents(f.delivery_fee || "0");
    if (price === null) return toast.error("Price should be a number of rand, like 250 or 89.50");
    if (fee === null) return toast.error("Delivery fee should be a number of rand");
    setBusy(true);
    const body = {
      title: f.title,
      slug: f.slug || undefined,
      subtitle: f.subtitle || null,
      description: f.description || null,
      kind: f.kind,
      status: f.status,
      price_cents: price,
      subscription_months: f.kind === "subscription" ? Number(f.subscription_months) || 12 : null,
      allow_delivery: f.allow_delivery,
      allow_collect: f.allow_collect,
      delivery_fee_cents: fee,
      is_preorder: f.is_preorder,
      preorder_ships_on: f.is_preorder && f.preorder_ships_on ? f.preorder_ships_on : null,
      allow_gift: f.allow_gift,
      allow_code_packs: f.allow_code_packs,
      sort_order: Number(f.sort_order) || 100,
      cover_image_url: product?.cover_image_url ?? null,
    };
    const res = await fetch(product ? `/api/store/admin/products/${product.id}` : "/api/store/admin/products", {
      method: product ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return toast.error(out?.error ?? "Didn't save");
    toast.success(product ? "Saved" : "Product created. Now add a cover and the PDF.");
    if (!product) router.push(`/store/admin/products/${out.product.id}`);
    else router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-6 px-5 py-6 md:grid-cols-2 md:px-8">
      <div className="space-y-4">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Year-End Review 2026" />
        </div>
        <div>
          <Label htmlFor="slug">Link name</Label>
          <Input id="slug" value={f.slug} onChange={(e) => set("slug", slugify(e.target.value))} placeholder={slugify(f.title) || "year-end-review-2026"} />
          <p className="mt-1 font-mono text-[11px] text-[color:var(--text-tertiary)]">/store/p/{f.slug || slugify(f.title) || "…"}</p>
        </div>
        <div>
          <Label htmlFor="subtitle">One line under the title</Label>
          <Input id="subtitle" value={f.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={6} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>

      <div className="space-y-5">
        <fieldset>
          <legend className="mono-label mb-2">What it is</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                disabled={!!product && product.kind !== k.id && (product.kind === "physical") !== (k.id === "physical")}
                onClick={() => set("kind", k.id)}
                aria-pressed={f.kind === k.id}
                className={`min-h-16 border px-3 py-2 text-left transition-colors disabled:opacity-40 ${f.kind === k.id ? "border-ink bg-bone" : "border-rule-strong hover:border-ink"}`}
              >
                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.14em]">{k.label}</span>
                <span className="mt-0.5 block font-sans text-[12px] normal-case tracking-normal text-[color:var(--text-secondary)]">{k.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="price">Price (R)</Label>
            <Input id="price" required inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="250" />
          </div>
          {f.kind === "subscription" && (
            <div>
              <Label htmlFor="months">Months</Label>
              <Input id="months" type="number" min={1} max={36} value={f.subscription_months} onChange={(e) => set("subscription_months", e.target.value)} />
            </div>
          )}
        </div>

        {ships && (
          <div className="space-y-3 border-l-2 border-ink pl-4">
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={f.allow_collect} onCheckedChange={(v) => set("allow_collect", !!v)} /> Collect at base</label>
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={f.allow_delivery} onCheckedChange={(v) => set("allow_delivery", !!v)} /> Delivery</label>
            {f.allow_delivery && (
              <div className="w-40">
                <Label htmlFor="fee">Delivery fee (R)</Label>
                <Input id="fee" inputMode="decimal" value={f.delivery_fee} onChange={(e) => set("delivery_fee", e.target.value)} />
              </div>
            )}
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={f.is_preorder} onCheckedChange={(v) => set("is_preorder", !!v)} /> Preorder (not in stock yet)</label>
            {f.is_preorder && (
              <div className="w-48">
                <Label htmlFor="ships">Ships from</Label>
                <Input id="ships" type="date" value={f.preorder_ships_on} onChange={(e) => set("preorder_ships_on", e.target.value)} />
              </div>
            )}
          </div>
        )}

        {readable && (
          <div className="space-y-3">
            {f.kind !== "bundle" && (
              <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={f.allow_gift} onCheckedChange={(v) => set("allow_gift", !!v)} /> Can be bought as a gift</label>
            )}
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={f.allow_code_packs} onCheckedChange={(v) => set("allow_code_packs", !!v)} /> Sell group code packs</label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="status">Status</Label>
            <select id="status" value={f.status} onChange={(e) => set("status", e.target.value as ProductStatus)} className="block h-10 w-full border border-input bg-white px-3 text-[14px]">
              <option value="draft">Draft (hidden)</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <Label htmlFor="sort">Order on the store</Label>
            <Input id="sort" type="number" min={0} value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
          </div>
        </div>

        <Button type="submit" disabled={busy} className="w-full">{busy ? "Saving…" : product ? "Save" : "Create product"}</Button>
      </div>
    </form>
  );
}
