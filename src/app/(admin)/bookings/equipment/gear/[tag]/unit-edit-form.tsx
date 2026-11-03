"use client";

// Edit one unit: what a shelf check can correct (label, serial, condition,
// purchase details, where it is, who it's assigned to, status). Sends only
// the fields that changed to PATCH /api/equipment/units/[tag], which writes
// the change into the unit's history.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { parseRands } from "@/lib/equipment/listing";
import { EDITABLE_UNIT_STATUSES, type EditableUnitStatus } from "@/lib/equipment/unit-edit";

type Values = {
  label: string;
  serial: string;
  condition: string;
  condition_note: string;
  supplier: string;
  purchase_date: string;
  /** Rands, as typed. */
  purchase_price: string;
  warranty_until: string;
  last_checked_on: string;
  location_id: string;
  owner_label: string;
  status: EditableUnitStatus;
};

const STATUS_TEXT: Record<EditableUnitStatus, string> = {
  available: "Available",
  maintenance: "Maintenance (can't be booked)",
  retired: "Retired (gone, or never existed)",
};

const TEXT_KEYS = [
  "label",
  "serial",
  "condition",
  "condition_note",
  "supplier",
  "purchase_date",
  "warranty_until",
  "last_checked_on",
  "location_id",
  "owner_label",
] as const;

export function UnitEditForm({
  tag,
  initial,
  locations,
}: {
  tag: string;
  initial: Values;
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const price = parseRands(v.purchase_price);

  async function save() {
    if (Number.isNaN(price)) {
      setError("The purchase price isn't a number. Use rands, like 1200 or 1200.50.");
      return;
    }
    const body: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) {
      if (v[k].trim() !== initial[k].trim()) body[k] = v[k].trim() || null;
    }
    if (v.purchase_price.trim() !== initial.purchase_price.trim()) body.purchase_price_cents = price;
    if (v.status !== initial.status) body.status = v.status;
    if (Object.keys(body).length === 0) {
      setOpen(false);
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/equipment/units/${encodeURIComponent(tag)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "That didn't save. Try again.");
      return;
    }
    setSaved(true);
    setOpen(false);
    router.refresh();
  }

  const box = "w-full rounded-[8px] border border-[color:var(--hire-line-strong)] bg-transparent px-3.5 text-[15px]";

  if (!open) {
    return (
      <div className="flex items-center gap-3 border-b border-[color:var(--hire-line)] px-[18px] py-3 md:border-b-0 md:px-0 md:pt-5">
        <button
          type="button"
          onClick={() => {
            setV(initial);
            setOpen(true);
            setSaved(false);
          }}
          className="flex h-11 items-center rounded-[8px] border border-[color:var(--hire-line-strong)] px-5 text-[14px] text-[color:var(--hire-ink)] hover:bg-[color:var(--hire-hover)]"
        >
          Edit
        </button>
        {saved && <span className="text-[13px] text-[color:var(--hire-ok)]">Saved. It&apos;s in the history below.</span>}
      </div>
    );
  }

  return (
    <section className="border-b border-[color:var(--hire-line)] px-[18px] py-4 md:mt-7 md:border md:px-5">
      <h2 className="hire-label mb-3">Edit {tag}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Label" hint="What's written on it">
          <input value={v.label} onChange={(e) => set("label", e.target.value)} className={cn(box, "h-11")} />
        </Field>
        <Field label="Serial">
          <input value={v.serial} onChange={(e) => set("serial", e.target.value)} className={cn(box, "hire-mono h-11")} />
        </Field>
        <Field label="Condition" hint="Brand new, Working, Broken…">
          <input value={v.condition} onChange={(e) => set("condition", e.target.value)} className={cn(box, "h-11")} />
        </Field>
        <Field label="Status">
          <select
            value={v.status}
            onChange={(e) => set("status", e.target.value as EditableUnitStatus)}
            className={cn(box, "h-11")}
          >
            {EDITABLE_UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_TEXT[s]}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Condition note">
            <textarea
              value={v.condition_note}
              onChange={(e) => set("condition_note", e.target.value)}
              rows={2}
              className={cn(box, "py-2.5")}
            />
          </Field>
        </div>
        <Field label="Where it is">
          <select value={v.location_id} onChange={(e) => set("location_id", e.target.value)} className={cn(box, "h-11")}>
            <option value="">No location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assigned to" hint="As written, e.g. SBS School">
          <input value={v.owner_label} onChange={(e) => set("owner_label", e.target.value)} className={cn(box, "h-11")} />
        </Field>
        <Field label="Supplier">
          <input value={v.supplier} onChange={(e) => set("supplier", e.target.value)} className={cn(box, "h-11")} />
        </Field>
        <Field label="Last checked">
          <input
            type="date"
            value={v.last_checked_on}
            onChange={(e) => set("last_checked_on", e.target.value)}
            className={cn(box, "h-11")}
          />
        </Field>
        <Field label="Purchase date">
          <input
            type="date"
            value={v.purchase_date}
            onChange={(e) => set("purchase_date", e.target.value)}
            className={cn(box, "h-11")}
          />
        </Field>
        <Field label="Purchase price" hint="Rands, excl. VAT">
          <input
            inputMode="decimal"
            value={v.purchase_price}
            onChange={(e) => set("purchase_price", e.target.value)}
            placeholder="none"
            className={cn(box, "h-11", Number.isNaN(price) && "border-[color:var(--hire-accent)]")}
          />
        </Field>
        <Field label="Warranty until">
          <input
            type="date"
            value={v.warranty_until}
            onChange={(e) => set("warranty_until", e.target.value)}
            className={cn(box, "h-11")}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-[14px] text-[color:var(--hire-accent)]">{error}</p>}
      <div className="mt-4 flex gap-2.5">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex h-11 min-w-[96px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] px-5 text-[14px] font-bold text-[color:var(--hire-on-accent)]"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="flex h-11 items-center rounded-[8px] border border-[color:var(--hire-line-strong)] px-5 text-[14px] text-[color:var(--hire-ink)]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="hire-label mb-1.5 block">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal text-[color:var(--hire-dim)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
