"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { EquipmentSettings } from "@/services/equipment";
import { centsToInput, parseRands } from "@/lib/equipment/listing";

// Percentages are stored as basis points (1500 = 15%). The form talks in
// percent and rands, and converts on the way out.
const bpsToPct = (bps: number) => String(bps / 100);
function pctToBps(v: string): number {
  const s = v.replace(/[\s%]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

export function SettingsForm({ canEdit, settings }: { canEdit: boolean; settings: EquipmentSettings }) {
  const router = useRouter();
  const [vat, setVat] = useState(bpsToPct(settings.vat_bps));
  const [waiver, setWaiver] = useState(bpsToPct(settings.waiver_bps));
  const [cover, setCover] = useState(centsToInput(settings.waiver_cover_cents));
  const [refundDays, setRefundDays] = useState(String(settings.deposit_refund_days));
  const [agreement, setAgreement] = useState(settings.agreement_version);
  const [xero, setXero] = useState(settings.xero_item_code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      vat_bps: pctToBps(vat),
      waiver_bps: pctToBps(waiver),
      waiver_cover_cents: parseRands(cover) ?? 0,
      deposit_refund_days: /^\d+$/.test(refundDays.trim()) ? Number(refundDays) : Number.NaN,
      agreement_version: agreement,
      xero_item_code: xero.trim() || null,
    };
    if (Object.values(body).some((v) => typeof v === "number" && Number.isNaN(v))) {
      setMsg({ ok: false, text: "One of the numbers isn't a number. Percentages like 15, rands like 5000." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/equipment/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: json.error ?? "That didn't save." });
    if (res.ok) router.refresh();
  }

  const row = "grid gap-1.5 border-b border-[color:var(--hire-line)] py-3.5 md:grid-cols-[260px_minmax(0,1fr)] md:items-center md:gap-6";
  const input = "min-h-[48px] w-full max-w-[320px] px-3.5 text-[16px]";

  return (
    <form onSubmit={save} className="px-[18px] md:px-9">
      {!canEdit && (
        <p className="py-3 text-[14px]">Only the rental manager can change these. You can see them here.</p>
      )}
      <fieldset disabled={!canEdit || busy}>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">VAT, %</span>
            <span className="text-[12px] text-[color:var(--hire-muted)]">Charged on hire plus waiver.</span>
          </span>
          <input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className={input} />
        </label>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">Damage waiver, % of hire</span>
            <span className="text-[12px] text-[color:var(--hire-muted)]">Added to every outside hire. Ministry orders don&apos;t pay it.</span>
          </span>
          <input inputMode="decimal" value={waiver} onChange={(e) => setWaiver(e.target.value)} className={input} />
        </label>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">Waiver covers up to, R</span>
            <span className="text-[12px] text-[color:var(--hire-muted)]">Per order. Shown in the agreement.</span>
          </span>
          <input inputMode="decimal" value={cover} onChange={(e) => setCover(e.target.value)} className={input} />
        </label>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">Deposit back within, working days</span>
          </span>
          <input inputMode="numeric" value={refundDays} onChange={(e) => setRefundDays(e.target.value)} className={input} />
        </label>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">Agreement version</span>
            <span className="text-[12px] text-[color:var(--hire-muted)]">Saved on every order a customer signs.</span>
          </span>
          <input value={agreement} onChange={(e) => setAgreement(e.target.value)} className={input} />
        </label>
        <label className={row}>
          <span>
            <span className="block text-[15px] text-[color:var(--hire-ink)]">Xero item code</span>
            <span className="text-[12px] text-[color:var(--hire-muted)]">Used on the invoice for each paid hire.</span>
          </span>
          <input value={xero} onChange={(e) => setXero(e.target.value)} placeholder="Not set" className={input} />
        </label>
      </fieldset>
      {canEdit && (
        <div className="flex items-center gap-4 py-4">
          <button
            type="submit"
            disabled={busy}
            className="flex h-12 min-w-[140px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] px-6 text-[15px] font-bold text-[color:var(--hire-on-accent)]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </button>
          {msg && (
            <span className={msg.ok ? "text-[13px] text-[color:var(--hire-ok)]" : "text-[14px] text-[color:var(--hire-accent)]"}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
