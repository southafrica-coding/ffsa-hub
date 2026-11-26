"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { parseRandsToCents } from "@/lib/store/money";
import type { StoreVariant } from "@/lib/store/types";
import { cn } from "@/lib/utils/cn";

export function CoverUpload({ productId, hasCover }: { productId: string; hasCover: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(0);
  async function upload(file: File) {
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/store/admin/products/${productId}/cover`, { method: "POST", body: form }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return toast.error(body?.error ?? "Cover didn't upload");
    toast.success("Cover saved");
    setV((x) => x + 1);
    router.refresh();
  }
  return (
    <div className="flex items-start gap-5 px-5 py-5 md:px-8">
      <div className="aspect-[3/4] w-28 shrink-0 border border-ink bg-bone-2">
        {hasCover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/store/cover/${productId}?v=${v}`} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-2">
        <p className="text-[13px] text-[color:var(--text-secondary)]">Portrait, 3:4, at least 900px wide. JPG, PNG or WebP under 4 MB.</p>
        <label className="inline-flex min-h-11 cursor-pointer items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone">
          {busy ? "Uploading…" : hasCover ? "Replace cover" : "Upload cover"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}

export function PdfUpload({ productId }: { productId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "uploading" | "rendering">("idle");
  async function upload(file: File) {
    if (file.type !== "application/pdf") return toast.error("That isn't a PDF");
    setStep("uploading");
    try {
      const start = await fetch(`/api/store/admin/products/${productId}/pdf`, { method: "POST" });
      const s = await start.json();
      if (!start.ok) throw new Error(s.error ?? "Couldn't start the upload");
      const { error } = await createClient().storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, file, { contentType: "application/pdf" });
      if (error) throw new Error(error.message);
      setStep("rendering");
      const render = await fetch(`/api/store/admin/assets/${s.assetId}/render`, { method: "POST" });
      const r = await render.json().catch(() => ({}));
      if (!render.ok) throw new Error(r.error ?? "Rendering failed");
      toast.success(`Flipbook ready: ${r.pages} pages`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      router.refresh();
    } finally {
      setStep("idle");
    }
  }
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center border border-ink bg-ink px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[var(--ink-bg-hover)]", step !== "idle" && "pointer-events-none opacity-60")}>
      {step === "uploading" ? "Uploading PDF…" : step === "rendering" ? "Making pages… (up to a few minutes)" : "Upload PDF"}
      <input type="file" accept="application/pdf" className="sr-only" disabled={step !== "idle"} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </label>
  );
}

export function PreviewPicker({ assetId, pages }: { assetId: string; pages: Array<{ n: number; preview: boolean; url: string }> }) {
  const router = useRouter();
  const [chosen, setChosen] = useState(new Set(pages.filter((p) => p.preview).map((p) => p.n)));
  const [busy, setBusy] = useState(false);
  const toggle = (n: number) => setChosen((s) => {
    const next = new Set(s);
    if (next.has(n)) next.delete(n);
    else if (next.size < 12) next.add(n);
    return next;
  });
  async function save() {
    setBusy(true);
    const res = await fetch(`/api/store/admin/assets/${assetId}/preview`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: [...chosen].sort((a, b) => a - b) }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return toast.error("Didn't save");
    toast.success("Preview pages saved");
    router.refresh();
  }
  return (
    <div className="border-t border-rule px-5 py-5 md:px-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[color:var(--text-secondary)]">Tap pages anyone can flip through before buying (up to 12). {chosen.size} chosen.</p>
        <Button type="button" size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save preview pages"}</Button>
      </div>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-8">
        {pages.map((p) => (
          <li key={p.n}>
            <button type="button" onClick={() => toggle(p.n)} aria-pressed={chosen.has(p.n)} className={cn("relative block w-full border-2", chosen.has(p.n) ? "border-yellow" : "border-transparent opacity-70 hover:opacity-100")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Page ${p.n}`} loading="lazy" className="block w-full border border-rule" />
              <span className={cn("absolute left-0 top-0 px-1.5 py-0.5 font-mono text-[10px] font-bold", chosen.has(p.n) ? "bg-yellow text-ink" : "bg-ink text-white")}>{p.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VariantsEditor({ productId, variants }: { productId: string; variants: StoreVariant[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ label: "", stock: "", price: "" });
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/store/admin/products/${productId}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(out?.error ?? "Didn't save");
      return false;
    }
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const price = draft.price ? parseRandsToCents(draft.price) : null;
    if (draft.price && price === null) return toast.error("Price should be a number of rand");
    const ok = await post({ label: draft.label, stock: draft.stock === "" ? null : Math.max(0, Number(draft.stock)), price_cents: price, sort_order: (variants.length + 1) * 10 });
    if (ok) setDraft({ label: "", stock: "", price: "" });
  }

  async function remove(id: string) {
    const res = await fetch(`/api/store/admin/products/${productId}/variants?variant=${id}`, { method: "DELETE" }).catch(() => null);
    const out = await res?.json().catch(() => ({}));
    if (!res?.ok) return toast.error(out?.error ?? "Didn't remove");
    toast.success(out.hidden ? "Hidden (it has orders, so it's kept for history)" : "Removed");
    router.refresh();
  }

  return (
    <div className="px-5 py-5 md:px-8">
      {variants.length > 0 && (
        <table className="mb-4 w-full max-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-rule text-left">
              {["Size", "Stock", "Price", ""].map((h) => <th key={h} className="mono-label py-2 pr-3 font-bold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className={cn("border-b border-rule", !v.active && "opacity-50")}>
                <td className="py-2 pr-3 font-semibold">{v.label}{!v.active && " (hidden)"}</td>
                <td className="py-2 pr-3">
                  <Input
                    type="number"
                    min={0}
                    defaultValue={v.stock ?? ""}
                    placeholder="∞"
                    className="h-9 w-24 tabular-nums"
                    onBlur={(e) => {
                      const val = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                      if (val !== v.stock) post({ id: v.id, label: v.label, stock: val });
                    }}
                  />
                </td>
                <td className="py-2 pr-3 tabular-nums">{v.price_cents == null ? "Product price" : `R ${(v.price_cents / 100).toFixed(2)}`}</td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => remove(v.id)} className="min-h-9 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)] hover:text-destructive">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div><span className="mono-label mb-1 block">Size</span><Input required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="M" className="h-10 w-28" /></div>
        <div><span className="mono-label mb-1 block">Stock</span><Input type="number" min={0} value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value })} placeholder="∞" className="h-10 w-24" /></div>
        <div><span className="mono-label mb-1 block">Price (optional)</span><Input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="same" className="h-10 w-28" /></div>
        <Button type="submit" disabled={busy}>Add size</Button>
      </form>
      <p className="mt-2 text-[12px] text-[color:var(--text-tertiary)]">Leave stock empty to stop counting. Preorders ignore stock.</p>
    </div>
  );
}
