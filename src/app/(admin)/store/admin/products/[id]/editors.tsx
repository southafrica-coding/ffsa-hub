"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { parseRandsToCents } from "@/lib/store/money";
import { formatMb, MAX_AUDIO_BYTES, MAX_PDF_BYTES, resolveAudioContentType } from "@/lib/store/upload";
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
  const [progress, setProgress] = useState<string | null>(null);

  // The PDF goes straight from this browser to private Supabase Storage on a
  // signed URL. It must never be posted to a Hub route: Vercel caps function
  // bodies at 4.5 MB and a Review is 20+ MB. See src/lib/store/upload.ts.
  async function upload(file: File) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return toast.error("That isn't a PDF");
    if (file.size > MAX_PDF_BYTES) return toast.error(`That PDF is ${formatMb(file.size)}. The limit is ${formatMb(MAX_PDF_BYTES)}.`);
    setStep("uploading");
    setProgress(formatMb(file.size));
    try {
      const start = await fetch(`/api/store/admin/products/${productId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: "application/pdf", size: file.size }),
      });
      const s = await start.json();
      if (!start.ok) throw new Error(s.error ?? "Couldn't start the upload");
      const { error } = await createClient().storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, file, { contentType: "application/pdf" });
      if (error) throw new Error(error.message);

      setStep("rendering");
      setProgress(null);
      const done = await fetch(`/api/store/admin/assets/${s.assetId}/complete`, { method: "POST" });
      const d = await done.json().catch(() => ({}));
      if (!done.ok) throw new Error(d.error ?? "Couldn't start making the pages");

      // Rendering runs in the background; poll until it's ready or failed.
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/store/admin/assets/${s.assetId}`, { cache: "no-store" });
        const a = await res.json().catch(() => ({}));
        if (a.status === "ready") {
          toast.success(`Flipbook ready: ${a.pages} pages`);
          return;
        }
        if (a.status === "failed") throw new Error(a.error ?? "Rendering failed");
        if (a.pages) setProgress(`${a.pages} pages so far`);
      }
      throw new Error("Still making the pages. Refresh in a minute to check.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setStep("idle");
      setProgress(null);
      router.refresh();
    }
  }
  return (
    <div className="space-y-2">
      <label className={cn("inline-flex min-h-11 cursor-pointer items-center border border-ink bg-ink px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[var(--ink-bg-hover)]", step !== "idle" && "pointer-events-none opacity-60")}>
        {step === "uploading" ? "Uploading PDF…" : step === "rendering" ? "Making pages…" : "Upload PDF"}
        <input type="file" accept="application/pdf" className="sr-only" disabled={step !== "idle"} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
        {progress ?? `PDF up to ${formatMb(MAX_PDF_BYTES)}`}
      </p>
    </div>
  );
}

export function AudioUpload({ productId, current }: { productId: string; current: { url: string } | null }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState<"idle" | "uploading" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);

  // Like the PDF: straight from this browser to the private store-audio
  // bucket on a signed URL, never through a Hub route.
  function fail(message: string) {
    setError(message);
    toast.error(message);
  }

  async function upload(file: File | undefined) {
    if (!file) return fail("Choose an audio file to upload.");
    // Some browsers leave file.type empty for an MP3; use the name too.
    const type = resolveAudioContentType(file);
    if (!type) return fail("That isn't an audio file. Use MP3, M4A, WAV or OGG.");
    if (file.size > MAX_AUDIO_BYTES) return fail(`That file is ${formatMb(file.size)}. The limit is ${formatMb(MAX_AUDIO_BYTES)}.`);
    setBusy("uploading");
    setError(null);
    try {
      const start = await fetch(`/api/store/admin/products/${productId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: type, size: file.size }),
      }).catch(() => null);
      const s = await start?.json().catch(() => ({}));
      if (!start?.ok) throw new Error(s?.error ?? "Couldn't start the upload");
      const { error: upError } = await createClient().storage.from(s.bucket).uploadToSignedUrl(s.path, s.token, file, { contentType: type });
      if (upError) throw new Error(upError.message);
      const done = await fetch(`/api/store/admin/products/${productId}/audio`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: s.path }),
      }).catch(() => null);
      const d = await done?.json().catch(() => ({}));
      if (!done?.ok) throw new Error(d?.error ?? "Couldn't save the music");
      toast.success("Music saved");
    } catch (e) {
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy("idle");
      router.refresh();
    }
  }

  async function remove() {
    setBusy("removing");
    setError(null);
    const res = await fetch(`/api/store/admin/products/${productId}/audio`, { method: "DELETE" }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy("idle");
    if (!res?.ok) return fail(body?.error ?? "Couldn't remove the music");
    toast.success("Music removed");
    router.refresh();
  }

  return (
    <div className="space-y-3 px-5 py-5 md:px-8">
      <p className="max-w-[640px] text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
        Optional. Plays quietly behind the flipbook for people who bought it, once they tap the page; the speaker button mutes it. Leave it empty for no music. Only use music FFSA has the rights to.
      </p>
      {current && (
        <audio controls preload="none" src={current.url} className="w-full max-w-[420px]" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {/* The input covers the label so a click always hits the control
            (sr-only + implicit label association can fail to fire onChange). */}
        <label htmlFor={inputId} className={cn("relative inline-flex min-h-11 cursor-pointer items-center overflow-hidden border border-ink px-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] hover:bg-bone", busy !== "idle" && "pointer-events-none opacity-60")}>
          {busy === "uploading" ? "Uploading…" : current ? "Replace music" : "Upload music"}
          <input
            id={inputId}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/wave,audio/ogg,audio/webm,.mp3,.m4a,.aac,.wav,.ogg,.oga,.webm"
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={busy !== "idle"}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              void upload(chosen);
            }}
          />
        </label>
        {current && (
          <button type="button" onClick={remove} disabled={busy !== "idle"} className="inline-flex min-h-11 items-center px-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline decoration-2 underline-offset-4 disabled:opacity-60">
            {busy === "removing" ? "Removing…" : "Remove music"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">{error}</p>
      )}
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">MP3, M4A, WAV or OGG · up to {formatMb(MAX_AUDIO_BYTES)}</p>
    </div>
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
        <>
          {/* Phones: one stacked row per size. The table is md and up. */}
          <ul className="mb-4 border-t border-rule md:hidden">
            {variants.map((v) => (
              <li key={v.id} className={cn("border-b border-rule py-3", !v.active && "opacity-50")}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-semibold">{v.label}{!v.active && " (hidden)"}</span>
                  <span className="shrink-0 text-[13px] tabular-nums">{priceText(v)}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <label className="block">
                    <span className="mono-label mb-1 block">Stock</span>
                    <StockInput v={v} onSave={(stock) => post({ id: v.id, label: v.label, stock })} />
                  </label>
                  <RemoveButton onClick={() => remove(v.id)} />
                </div>
              </li>
            ))}
          </ul>
          <table className="mb-4 hidden w-full max-w-[640px] text-[13px] md:table">
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
                    <StockInput v={v} onSave={(stock) => post({ id: v.id, label: v.label, stock })} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{priceText(v)}</td>
                  <td className="py-2 text-right">
                    <RemoveButton onClick={() => remove(v.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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

const priceText = (v: StoreVariant) => (v.price_cents == null ? "Product price" : `R ${(v.price_cents / 100).toFixed(2)}`);

function StockInput({ v, onSave }: { v: StoreVariant; onSave: (stock: number | null) => void }) {
  return (
    <Input
      type="number"
      min={0}
      defaultValue={v.stock ?? ""}
      placeholder="∞"
      aria-label={`Stock for ${v.label}`}
      className="h-10 w-24 tabular-nums md:h-9"
      onBlur={(e) => {
        const val = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
        if (val !== v.stock) onSave(val);
      }}
    />
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)] hover:text-destructive md:min-h-9">
      Remove
    </button>
  );
}
