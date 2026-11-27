"use client";

// Add or edit one embassy profile. Global legal only; the route and RLS
// check that again.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorLine, VisaButton } from "@/components/visas/visa-ui";
import type { Embassy } from "@/lib/visas/embassies";

type Country = { iso2: string; name: string };

const INPUT = "min-h-11 w-full border border-rule-strong bg-white px-3 text-[14px] outline-none focus:border-ink";

function triState(v: boolean | null): string {
  return v === true ? "yes" : v === false ? "no" : "";
}
function fromTri(v: string): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

export function EmbassyForm({
  embassy,
  countries,
  onDone,
}: {
  embassy?: Embassy;
  countries: Country[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    country_iso: embassy?.country_iso ?? "",
    name: embassy?.name ?? "",
    city: embassy?.city ?? "",
    addressee: embassy?.addressee ?? "",
    accepts_scan: triState(embassy?.accepts_scan ?? null),
    needs_original: triState(embassy?.needs_original ?? null),
    blank_pages: embassy?.blank_pages?.toString() ?? "",
    processing_weeks: embassy?.processing_weeks?.toString() ?? "",
    appointment_weeks: embassy?.appointment_weeks?.toString() ?? "",
    website_url: embassy?.website_url ?? "",
    notes: embassy?.notes ?? "",
    is_active: embassy?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(embassy ? `/api/visas/embassies/${embassy.id}` : "/api/visas/embassies", {
      method: embassy ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        accepts_scan: fromTri(f.accepts_scan),
        needs_original: fromTri(f.needs_original),
      }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) return setError(json.error ?? "Something went wrong");
    if (!embassy) setF({ ...f, name: "", city: "", addressee: "", notes: "", website_url: "" });
    router.refresh();
    onDone?.();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="mono-label">Country it&apos;s in</span>
          <select value={f.country_iso} onChange={set("country_iso")} className={INPUT}>
            <option value="">Choose…</option>
            {countries.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">City</span>
          <input value={f.city} onChange={set("city")} maxLength={100} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="mono-label">Name (e.g. South African High Commission)</span>
          <input value={f.name} onChange={set("name")} maxLength={200} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="mono-label">Letters are addressed to (e.g. The High Commissioner)</span>
          <input value={f.addressee} onChange={set("addressee")} maxLength={200} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Accepts a scanned letter</span>
          <select value={f.accepts_scan} onChange={set("accepts_scan")} className={INPUT}>
            <option value="">Not known</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Needs the original letter</span>
          <select value={f.needs_original} onChange={set("needs_original")} className={INPUT}>
            <option value="">Not known</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Blank passport pages</span>
          <input value={f.blank_pages} onChange={set("blank_pages")} inputMode="numeric" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Processing (weeks)</span>
          <input value={f.processing_weeks} onChange={set("processing_weeks")} inputMode="numeric" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Wait for an appointment (weeks)</span>
          <input value={f.appointment_weeks} onChange={set("appointment_weeks")} inputMode="numeric" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mono-label">Website (https://…)</span>
          <input value={f.website_url} onChange={set("website_url")} maxLength={500} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="mono-label">Notes students and leaders see</span>
          <textarea
            value={f.notes}
            onChange={set("notes")}
            rows={3}
            maxLength={4000}
            className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px] outline-none focus:border-ink"
          />
        </label>
        {embassy && (
          <label className="flex min-h-11 items-center gap-2 text-[14px] md:col-span-2">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
            In use (untick to retire it; cases that used it keep it)
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <VisaButton disabled={busy || !f.country_iso || !f.name.trim() || !f.city.trim()} onClick={() => void save()}>
          {embassy ? "Save" : "Add embassy"}
        </VisaButton>
        {onDone && (
          <VisaButton tone="outline" onClick={onDone}>
            Cancel
          </VisaButton>
        )}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/** One row's Edit button that opens the form in place. */
export function EmbassyEdit({ embassy, countries }: { embassy: Embassy; countries: Country[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <VisaButton tone="outline" onClick={() => setOpen(true)}>
        Edit
      </VisaButton>
    );
  }
  return (
    <div className="mt-3 w-full border-t border-rule pt-3">
      <EmbassyForm embassy={embassy} countries={countries} onDone={() => setOpen(false)} />
    </div>
  );
}
