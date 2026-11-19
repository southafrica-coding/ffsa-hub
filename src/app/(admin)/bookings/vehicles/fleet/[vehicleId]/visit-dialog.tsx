"use client";

// Book / log a workshop visit, Record the outcome, Edit (the Fleet app's recordModal).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RECORD_KINDS } from "@/lib/fleet/rules/constants";
import { cn } from "@/lib/utils/cn";
import { ActionButton, vehicleHref } from "../_components/ui";
import { ClashError, fleetFetch, minsSince, uploadFleetFile } from "../_components/client-api";
import { F, Fieldset, field, grid2 } from "./form-bits";
import { WORK_CHECK, type Visit } from "./model";
import { bookingHint, initialVisitForm, visitBody, type HintTrip, type VisitFormState } from "./visit-form";

export interface VisitCtx {
  vehicle: { id: string; name: string; odometer: number | null };
  providers: string[];
  trips: HintTrip[];
  /** First free 48 hours: "new", plus one per booked visit that ignores that visit. */
  gaps: Record<string, { from: string; to: string } | null>;
  today: string;
}

export type VisitMode = "book" | "log" | "outcome" | "edit";
type Mode = VisitMode;

/** A button that opens the visit form. */
export function VisitButton({
  ctx,
  mode,
  visit,
  prefill,
  children,
  tone = "outline",
  className,
}: {
  ctx: VisitCtx;
  mode: Mode;
  visit?: Visit;
  /** Kind, dates and workshop to start with (the app's "Book" and "Move the workshop visit to …"). */
  prefill?: VisitPrefill;
  children: React.ReactNode;
  tone?: "solid" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton tone={tone} onClick={() => setOpen(true)} className={className}>
        {children}
      </ActionButton>
      {open && <VisitDialog ctx={ctx} mode={mode} visit={visit} prefill={prefill} onClose={() => setOpen(false)} />}
    </>
  );
}

export interface VisitPrefill {
  kind?: string;
  date?: string;
  until?: string;
  provider?: string;
}

export function VisitDialog({ ctx, mode, visit, prefill, onClose }: { ctx: VisitCtx; mode: Mode; visit?: Visit; prefill?: VisitPrefill; onClose: () => void }) {
  const router = useRouter();
  const rec = mode === "outcome" || mode === "edit" ? visit || null : null;
  const start: "booked" | "done" = mode === "book" ? "booked" : mode === "outcome" || mode === "log" ? "done" : visit?.status === "booked" ? "booked" : "done";
  const [f, setF] = useState<VisitFormState>(() => {
    const base = initialVisitForm(start, ctx.today, ctx.providers, rec);
    if (!prefill) return base;
    const p: Partial<VisitFormState> = {};
    if (prefill.kind) p.kind = prefill.kind;
    if (prefill.date) p.date = prefill.date;
    if (prefill.until) p.until = prefill.until;
    if (prefill.provider) Object.assign(p, ctx.providers.includes(prefill.provider) ? { provider: prefill.provider, providerOther: "" } : { provider: "__other", providerOther: prefill.provider });
    return { ...base, ...p };
  });
  const [openedAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (p: Partial<VisitFormState>) => setF((x) => ({ ...x, ...p }));
  const booked = f.status === "booked";
  const done = !booked;
  const kinds = !f.kind || RECORD_KINDS.includes(f.kind) ? RECORD_KINDS : [f.kind, ...RECORD_KINDS];
  const hint = booked ? bookingHint(ctx.trips, f.date, f.until, (rec && rec.id in ctx.gaps ? ctx.gaps[rec.id] : ctx.gaps.new) ?? null) : null;
  const title = `${rec ? "Workshop visit" : booked ? "Book a workshop visit" : "Log a workshop visit"} · ${ctx.vehicle.name}`;

  async function save() {
    const out = visitBody(ctx.vehicle.id, f, minsSince(openedAt), rec);
    if ("error" in out) return toast.error(out.error);
    const url = rec ? `/api/vehicles/fleet/visits/${rec.id}` : "/api/vehicles/fleet/visits";
    const method = rec ? "PUT" : "POST";
    setSaving(true);
    try {
      let r: { message?: string };
      try {
        r = await fleetFetch(url, { method, body: out.body });
      } catch (e) {
        if (!(e instanceof ClashError) || !window.confirm(e.message)) throw e;
        r = await fleetFetch(url, { method, body: { ...out.body, force: true } });
      }
      toast.success(r.message || (booked ? "Workshop booking saved." : "Workshop visit saved."));
      onClose();
      // As the app: on the vehicle's own page, show History; elsewhere (Today, Calendar)
      // stay where you are.
      if (window.location.pathname === vehicleHref(ctx.vehicle.id)) router.push(vehicleHref(ctx.vehicle.id, "history"));
      router.refresh();
    } catch (e) {
      if (!(e instanceof ClashError)) toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // The reference's delete-record. The route also clears a follow-up that pointed here.
  async function remove() {
    if (!rec || !window.confirm("Delete this workshop visit?")) return;
    setSaving(true);
    try {
      const r = await fleetFetch<{ message?: string }>(`/api/vehicles/fleet/visits/${rec.id}`, { method: "DELETE" });
      toast.success(r.message || "Workshop visit deleted.");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function upload(list: FileList | null) {
    const files = [...(list || [])];
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const r = await uploadFleetFile(file, { type: "visit", id: rec?.id });
        setF((x) => ({ ...x, files: [...x.files, { id: r.id, name: file.name, type: r.contentType || file.type }] }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const workSet = (i: number, p: Partial<VisitFormState["work"][number]>) => set({ work: f.work.map((w, j) => (j === i ? { ...w, ...p } : w)) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <div role="radiogroup" aria-label="Visit status" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["booked", "Booked", "The vehicle is going in"],
                ["done", "Done and collected", "Check the work and add the receipts"],
              ] as const
            ).map(([k, b, s]) => (
              <label key={k} className={cn("flex min-h-11 cursor-pointer gap-3 border px-3 py-2.5", f.status === k ? "border-ink bg-bone" : "border-rule-strong")}>
                <input type="radio" name="r-state" value={k} checked={f.status === k} onChange={() => set({ status: k })} className="mt-1" />
                <span className="grid">
                  <b className="text-[14px]">{b}</b>
                  <span className="text-[12px] text-[#55524A]">{s}</span>
                </span>
              </label>
            ))}
          </div>

          <div className={grid2}>
            <F label="Type of visit">
              <select className={field} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </F>
            <F label={booked ? "Going in on" : "Date"}>
              <input className={field} type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
            </F>
            <F label="Back on" hint="Same day if it’s back the same day" hidden={!booked}>
              <input className={field} type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} />
            </F>
            {hint && (hint.clash || hint.near || hint.gap) && (
              <div className="grid gap-1.5 text-[13px] sm:col-span-2" aria-live="polite">
                {hint.clash && <p className="border-l-[3px] border-amber-border bg-yellow-dim px-3 py-2">{hint.clash}</p>}
                {hint.near && <p>{hint.near}</p>}
                {hint.gap && (
                  <p>
                    First free 48 hours (weekdays): <strong>{hint.gap.text}</strong>{" "}
                    <button type="button" className="min-h-11 underline" onClick={() => set({ date: hint.gap!.from, until: hint.gap!.to })}>
                      Use these dates
                    </button>
                  </p>
                )}
              </div>
            )}
            <F label="Workshop or provider">
              <select className={field} value={f.provider} onChange={(e) => set({ provider: e.target.value })}>
                <option value="">Not specified</option>
                {ctx.providers.map((n) => (
                  <option key={n}>{n}</option>
                ))}
                <option value="__other">Other…</option>
              </select>
            </F>
            <F label="Provider name" hidden={f.provider !== "__other"}>
              <input className={field} type="text" value={f.providerOther} onChange={(e) => set({ providerOther: e.target.value })} />
            </F>
            <F label="Odometer (km)" hidden={!done}>
              <input
                className={field}
                type="text"
                inputMode="numeric"
                value={f.odometer}
                placeholder={ctx.vehicle.odometer != null ? String(ctx.vehicle.odometer) : ""}
                onChange={(e) => set({ odometer: e.target.value })}
              />
            </F>
            <F label="Total cost (R, incl. VAT)" hidden={!done}>
              <input className={field} type="text" inputMode="decimal" value={f.cost} placeholder="Adds up the lines if left empty" onChange={(e) => set({ cost: e.target.value })} />
            </F>
            <F label="Invoice or job card no." hidden={!done}>
              <input className={field} type="text" value={f.ref} onChange={(e) => set({ ref: e.target.value })} />
            </F>
            <F label={booked ? "What should they do?" : "What was done or found"} wide>
              <textarea
                className={field}
                rows={3}
                value={f.description}
                placeholder="e.g. Bumper-to-bumper check and quote for anything that needs fixing"
                onChange={(e) => set({ description: e.target.value })}
              />
            </F>
            <F label="New licence disc expiry" hidden={!done || f.kind !== "Licence renewal"}>
              <input className={field} type="date" value={f.disc} onChange={(e) => set({ disc: e.target.value })} />
            </F>
            {done && f.kind === "Service" && (
              <label className="flex min-h-11 items-center gap-2 text-[14px] sm:col-span-2">
                <input type="checkbox" checked={f.updateLastService} onChange={(e) => set({ updateLastService: e.target.checked })} className="h-5 w-5" />
                Use this as the vehicle’s last service
              </label>
            )}
          </div>

          {done && (
            <>
              <Fieldset legend="Check the work when you collect it">
                <p className="text-[12px] text-[#55524A]">
                  List each job on the invoice, then check it before you drive away: look at body repairs in daylight, and test-drive after mechanical work.
                </p>
                {f.work.map((w, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2 border-b border-rule pb-3 sm:grid-cols-[minmax(0,1fr)_110px_170px_auto]">
                    <input
                      className={cn(field, "col-span-3 sm:col-span-1")}
                      value={w.d}
                      placeholder="e.g. Replaced front brake pads"
                      aria-label="Work done"
                      onChange={(e) => workSet(i, { d: e.target.value })}
                    />
                    <input className={field} inputMode="decimal" value={w.cost} placeholder="Cost (R)" aria-label="Cost" onChange={(e) => workSet(i, { cost: e.target.value })} />
                    <select className={field} value={w.chk} aria-label="Checked on collection" onChange={(e) => workSet(i, { chk: e.target.value })}>
                      <option value="">Not checked yet</option>
                      {Object.entries(WORK_CHECK).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Remove line"
                      className="flex min-h-11 min-w-11 items-center justify-center border border-rule-strong text-[18px]"
                      onClick={() => set({ work: f.work.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div>
                  <ActionButton onClick={() => set({ work: [...f.work, { d: "", cost: "", chk: "" }] })}>Add line</ActionButton>
                </div>
                <div className={grid2}>
                  <F label="Warranty on the work until">
                    <input className={field} type="date" value={f.warrantyUntil} onChange={(e) => set({ warrantyUntil: e.target.value })} />
                  </F>
                  <F label="Collected and checked by">
                    <input className={field} type="text" value={f.checkedBy} onChange={(e) => set({ checkedBy: e.target.value })} />
                  </F>
                </div>
              </Fieldset>
              <Fieldset legend="Next follow-up (optional)">
                <div className={grid2}>
                  <F label="Due date">
                    <input className={field} type="date" value={f.nextDate} onChange={(e) => set({ nextDate: e.target.value })} />
                  </F>
                  <F label="Due at (km)">
                    <input className={field} type="text" inputMode="numeric" value={f.nextKm} onChange={(e) => set({ nextKm: e.target.value })} />
                  </F>
                </div>
              </Fieldset>
              <Fieldset legend="Receipts, invoice, job card and photos">
                {f.files.length ? (
                  <ul className="grid gap-1">
                    {f.files.map((x, i) => (
                      <li key={x.id} className="flex items-center justify-between gap-2 border-b border-rule text-[14px]">
                        <span className="min-w-0 break-words">{x.name || "File"}</span>
                        <button
                          type="button"
                          className="min-h-11 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline"
                          aria-label={`Remove ${x.name || "file"}`}
                          onClick={() => set({ files: f.files.filter((_, j) => j !== i) })}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-[#55524A]">No files attached.</p>
                )}
                <label className="inline-flex min-h-11 w-fit cursor-pointer items-center border border-ink px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
                  {uploading ? "Uploading…" : "Add files"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    hidden
                    disabled={uploading}
                    onChange={(e) => {
                      upload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Fieldset>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {rec && (
            <ActionButton onClick={remove} disabled={saving} className="border-destructive text-destructive sm:mr-auto">
              Delete
            </ActionButton>
          )}
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving || uploading}>
            {saving ? "Saving…" : "Save"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
