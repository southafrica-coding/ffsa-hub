"use client";

// The Add item form. Rules live in lib/equipment/inventory.ts (readNewItem);
// the route checks them again. Phone first: one column, 44px+ targets.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TRACKINGS, TRACKING_HELP, TRACKING_LABEL, type Tracking } from "@/lib/equipment/inventory";
import { BOX, Choice, Field, PRIMARY } from "../../inventory-ui";

export function NewItemForm({
  locations,
  categories,
}: {
  locations: { id: string; name: string }[];
  categories: string[];
}) {
  const router = useRouter();
  const [tracking, setTracking] = useState<Tracking>("counted");
  const [v, setV] = useState({
    name: "",
    description: "",
    category: "",
    brand: "",
    model: "",
    locationId: "",
    quantity: "",
    tagPrefix: "",
    supplier: "",
    purchaseDate: "",
    unitCost: "",
    reorderAt: "",
  });
  const [requestable, setRequestable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v, value: string) => setV((x) => ({ ...x, [k]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/equipment/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...v, tracking, isRequestable: requestable }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok && !data.productId) {
      setError(data.error ?? "Couldn't add the item.");
      return;
    }
    router.push(`/bookings/equipment/gear/products/${data.productId}${data.error ? "?warn=1" : ""}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5 px-[18px] py-5 md:px-9">
      <section>
        <div className="hire-label mb-2">How do we keep track of it?</div>
        <div className="grid gap-2 md:grid-cols-3">
          {TRACKINGS.map((t) => (
            <Choice
              key={t}
              selected={tracking === t}
              onClick={() => setTracking(t)}
              title={TRACKING_LABEL[t]}
              help={TRACKING_HELP[t]}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">
          <input
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Black tablecloth, round"
            className={cn(BOX, "h-11")}
          />
        </Field>
        <Field label="Description" hint="what it is, size, colour, what tells it apart" className="md:col-span-2">
          <textarea
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
            rows={4}
            className={cn(BOX, "py-2.5")}
          />
        </Field>
        <Field label="Category">
          <input
            value={v.category}
            onChange={(e) => set("category", e.target.value)}
            list="inventory-categories"
            placeholder="decor, catering, lighting…"
            className={cn(BOX, "h-11")}
          />
          <datalist id="inventory-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Where it's kept">
          <select value={v.locationId} onChange={(e) => set("locationId", e.target.value)} className={cn(BOX, "h-11")}>
            <option value="">Not set</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Brand" hint="optional">
          <input value={v.brand} onChange={(e) => set("brand", e.target.value)} className={cn(BOX, "h-11")} />
        </Field>
        <Field label="Model" hint="optional">
          <input value={v.model} onChange={(e) => set("model", e.target.value)} className={cn(BOX, "h-11")} />
        </Field>

        <Field label={tracking === "tagged" ? "How many units" : "How many we have"}>
          <input
            value={v.quantity}
            onChange={(e) => set("quantity", e.target.value)}
            inputMode="numeric"
            className={cn(BOX, "h-11 tabular-nums")}
          />
        </Field>
        {tracking === "tagged" ? (
          <Field label="Tag prefix" hint="2–5 letters; numbers follow on">
            <input
              value={v.tagPrefix}
              onChange={(e) => set("tagPrefix", e.target.value.toUpperCase())}
              placeholder="AUD"
              className={cn(BOX, "hire-mono h-11")}
            />
          </Field>
        ) : tracking === "consumable" ? (
          <Field label="Reorder at" hint="optional: flag it when this few are left">
            <input
              value={v.reorderAt}
              onChange={(e) => set("reorderAt", e.target.value)}
              inputMode="numeric"
              className={cn(BOX, "h-11 tabular-nums")}
            />
          </Field>
        ) : (
          <span className="hidden md:block" />
        )}

        <Field label="Bought from" hint="optional">
          <input value={v.supplier} onChange={(e) => set("supplier", e.target.value)} className={cn(BOX, "h-11")} />
        </Field>
        <Field label="Bought on" hint="optional">
          <input
            type="date"
            value={v.purchaseDate}
            onChange={(e) => set("purchaseDate", e.target.value)}
            className={cn(BOX, "h-11")}
          />
        </Field>
        <Field label="Price each" hint="optional, rand">
          <input
            value={v.unitCost}
            onChange={(e) => set("unitCost", e.target.value)}
            inputMode="decimal"
            placeholder="45.00"
            className={cn(BOX, "h-11 tabular-nums")}
          />
        </Field>
      </div>

      {tracking !== "consumable" && (
        <label className="flex min-h-[44px] items-start gap-3 text-[14px] text-[color:var(--hire-ink)]">
          <input
            type="checkbox"
            checked={requestable}
            onChange={(e) => setRequestable(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[color:var(--hire-accent)]"
          />
          <span>
            Schools and ministries can ask to borrow it
            <span className="block text-[12px] text-[color:var(--hire-muted)]">
              Anyone signed in to the Hub can request it on Borrow equipment. You approve every request.
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-[14px] text-[color:var(--hire-accent)]">{error}</p>}
      <div>
        <button type="button" onClick={save} disabled={busy} className={PRIMARY}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add item"}
        </button>
      </div>
    </div>
  );
}
