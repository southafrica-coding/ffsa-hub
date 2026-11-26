"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normaliseCouponCode, type StoreCoupon } from "@/lib/store/coupons";
import { parseRandsToCents } from "@/lib/store/money";

type ProductOption = { id: string; title: string };

/** yyyy-mm-dd in the browser's own day, for <input type="date">. */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CouponForm({ coupon, products }: { coupon?: StoreCoupon; products: ProductOption[] }) {
  const router = useRouter();
  const used = coupon?.used_count ?? 0;
  const locked = used > 0;
  const [f, setF] = useState({
    code: coupon?.code ?? "",
    description: coupon?.description ?? "",
    type: (coupon?.amount_off_cents != null ? "amount" : "percent") as "percent" | "amount",
    percent: coupon?.percent_off != null ? String(coupon.percent_off) : "",
    amount: coupon?.amount_off_cents != null ? String(coupon.amount_off_cents / 100) : "",
    product_id: coupon?.product_id ?? "",
    max_uses: coupon?.max_uses != null ? String(coupon.max_uses) : "",
    expires_on: toDateInput(coupon?.expires_at),
    active: coupon?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!normaliseCouponCode(f.code)) return toast.error("Codes are 3 to 40 letters and numbers, with single hyphens between parts, like WELCOME20.");
    let percent_off: number | null = null;
    let amount_off_cents: number | null = null;
    if (f.type === "percent") {
      percent_off = Number(f.percent);
      if (!Number.isInteger(percent_off) || percent_off < 1 || percent_off > 100) return toast.error("Percent off is a whole number from 1 to 100.");
    } else {
      amount_off_cents = parseRandsToCents(f.amount);
      if (!amount_off_cents) return toast.error("Amount off should be a number of rand, like 50 or 89.50.");
    }
    const max = f.max_uses.trim() ? Number(f.max_uses) : null;
    if (max !== null && (!Number.isInteger(max) || max < 1)) return toast.error("Max uses is a whole number, 1 or more. Leave it blank for no limit.");
    if (max !== null && max < used) return toast.error(`It's been used ${used} times, so max uses can't be lower than that.`);

    setBusy(true);
    const body = {
      code: f.code,
      description: f.description.trim() || null,
      discount_type: f.type,
      percent_off,
      amount_off_cents,
      product_id: f.product_id || null,
      max_uses: max,
      // The end of the chosen day, in the browser's time zone.
      expires_at: f.expires_on ? new Date(`${f.expires_on}T23:59:59`).toISOString() : null,
      active: f.active,
    };
    const res = await fetch(coupon ? `/api/store/admin/coupons/${coupon.id}` : "/api/store/admin/coupons", {
      method: coupon ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return toast.error(out?.error ?? "Didn't save");
    toast.success(coupon ? "Saved" : `${out.coupon.code} is ready to use`);
    router.push("/store/admin/coupons");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-6 px-5 py-6 md:grid-cols-2 md:px-8">
      <div className="space-y-4">
        {locked && (
          <p className="border-l-2 border-ink bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
            Used {used} {used === 1 ? "time" : "times"}. The code, discount and product stay as they are. You can still change the note, end date, max uses and whether it&apos;s on.
          </p>
        )}
        <div>
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            required
            disabled={locked}
            value={f.code}
            onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s+/g, ""))}
            placeholder="WELCOME20"
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="min-h-11 font-mono uppercase tracking-[0.08em]"
          />
          <p className="mt-1 text-[12px] text-[color:var(--text-tertiary)]">Letters and numbers, with a hyphen between parts if you like. Buyers can type it in any case.</p>
        </div>
        <div>
          <Label htmlFor="description">Note for staff (optional)</Label>
          <Input id="description" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder="Autumn preview launch" className="min-h-11" />
        </div>
      </div>

      <div className="space-y-5">
        <fieldset disabled={locked}>
          <legend className="mono-label mb-2">Discount</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "percent", label: "Percent off" },
                { id: "amount", label: "Rand off" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => set("type", t.id)}
                aria-pressed={f.type === t.id}
                className={`min-h-11 border px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors disabled:opacity-40 ${f.type === t.id ? "border-ink bg-bone" : "border-rule-strong hover:border-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-3 w-40">
            {f.type === "percent" ? (
              <>
                <Label htmlFor="percent">Percent off</Label>
                <Input id="percent" required inputMode="numeric" value={f.percent} onChange={(e) => set("percent", e.target.value)} placeholder="20" className="min-h-11" />
              </>
            ) : (
              <>
                <Label htmlFor="amount">Rand off</Label>
                <Input id="amount" required inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="50" className="min-h-11" />
              </>
            )}
          </div>
          <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">Comes off the products only, never delivery. 100% makes the order free.</p>
        </fieldset>

        <div>
          <Label htmlFor="product">For</Label>
          <select
            id="product"
            disabled={locked}
            value={f.product_id}
            onChange={(e) => set("product_id", e.target.value)}
            className="block min-h-11 w-full min-w-0 border border-input bg-white px-3 text-[14px] disabled:opacity-60"
          >
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="max">Max uses</Label>
            <Input id="max" inputMode="numeric" value={f.max_uses} onChange={(e) => set("max_uses", e.target.value)} placeholder="No limit" className="min-h-11" />
          </div>
          <div>
            <Label htmlFor="ends">Last day</Label>
            <Input id="ends" type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} className="min-h-11" />
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-2 text-[14px]">
          <Checkbox checked={f.active} onCheckedChange={(v) => set("active", !!v)} /> On (buyers can use it)
        </label>

        <Button type="submit" disabled={busy} className="min-h-11 w-full">
          {busy ? "Saving…" : coupon ? "Save" : "Create coupon"}
        </Button>
      </div>
    </form>
  );
}
