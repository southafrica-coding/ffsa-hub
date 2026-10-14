"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { StatusPill } from "@/components/ffsa";
import { formatZAR } from "@/lib/finance/billing";
import {
  compileSchedule,
  emptyPayment,
  SCHEDULE_TIERS,
  type InvoiceTiming,
  type PaymentAmount,
  type PaymentScheduleDesign,
  type PaymentTiming,
  type SchedulePayment,
} from "@/lib/finance/payment-schedule";
import { buildSchedule, type BuilderChargeItem } from "@/lib/finance/schedule-builder";
import type { Tier } from "@/services/school-billing";

// One pricing target's payment schedule (migration 236): whole-program
// pricing, or one course's standalone pricing. Everything is checked live by
// the same compileSchedule() the server runs on save, so the preview can't
// promise something the save won't do.

export interface ScheduleTarget {
  courseId: string | null;
  name: string;
  arrivalDate: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function PaymentScheduleBuilder({
  programId,
  target,
  saved,
  startingPoint,
  startingPointLabel,
  template,
  canEdit,
}: {
  programId: string;
  target: ScheduleTarget;
  /** The saved design, if this target has one. */
  saved: PaymentScheduleDesign | null;
  /** Unsaved starting point when nothing is saved (e.g. converted from the
   *  target's existing hand-made charges). */
  startingPoint: PaymentScheduleDesign | null;
  startingPointLabel?: string;
  /** Offered as "Load FFX 2027" when the target matches the template. */
  template: PaymentScheduleDesign | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const initial: PaymentScheduleDesign = saved ??
    startingPoint ?? { tierPrices: { A: null, B: null, C: null }, payments: [] };
  const [design, setDesign] = useState<PaymentScheduleDesign>(initial);
  const [dirty, setDirty] = useState(!saved && !!startingPoint);
  const [saving, setSaving] = useState(false);
  const [previewTier, setPreviewTier] = useState<Tier>("A");
  const [trackingOptions, setTrackingOptions] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/integrations/xero/tracking-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j) return;
        setTrackingOptions([...new Set<string>([...(j.za ?? []), ...(j.us ?? [])])].sort());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const compiled = useMemo(
    () => compileSchedule(design, { hasArrivalDate: !!target.arrivalDate }),
    [design, target.arrivalDate]
  );

  const offered = SCHEDULE_TIERS.filter((t) => (design.tierPrices[t] ?? 0) > 0);
  const tierForPreview = offered.includes(previewTier) ? previewTier : offered[0];

  // Example run through the real engine: a student accepted today.
  const example = useMemo(() => {
    if (!tierForPreview || compiled.errors.length > 0) return [];
    const items = compiled.items.filter((i) => i.tier === tierForPreview) as unknown as BuilderChargeItem[];
    return buildSchedule(items, {
      acceptanceDate: today(),
      arrivalDate: target.arrivalDate,
      paymentPreference: "standard",
      today: today(),
    }).rows;
  }, [compiled, tierForPreview, target.arrivalDate]);

  const update = (next: PaymentScheduleDesign) => {
    setDesign(next);
    setDirty(true);
  };
  const setPayment = (i: number, patch: Partial<SchedulePayment>) =>
    update({ ...design, payments: design.payments.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const move = (i: number, d: -1 | 1) => {
    const ps = [...design.payments];
    const j = i + d;
    if (j < 0 || j >= ps.length) return;
    [ps[i], ps[j]] = [ps[j], ps[i]];
    update({ ...design, payments: ps });
  };

  async function save(replaceManual = false): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/finance/school-fees/billing-schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, courseId: target.courseId, design, replaceManual }),
      });
      const json = await res.json();
      if (res.status === 409 && json.needsConfirm) {
        setSaving(false);
        if (confirm(`${json.error}\n\nReplace them with this schedule?`)) await save(true);
        return;
      }
      if (!res.ok) {
        toast.error(json.error || "Couldn't save the schedule");
        return;
      }
      setDirty(false);
      toast.success(
        json.existingPlans > 0
          ? `Schedule saved. ${json.existingPlans} student${json.existingPlans === 1 ? " is" : "s are"} already set up and keep their current payments until rebuilt.`
          : "Schedule saved"
      );
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the payment schedule for ${target.name}? Its charges are removed too. Students already set up keep their payments.`)) return;
    setSaving(true);
    try {
      const qs = new URLSearchParams({ programId, ...(target.courseId ? { courseId: target.courseId } : {}) });
      const res = await fetch(`/api/finance/school-fees/billing-schedules?${qs}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Couldn't remove it");
        return;
      }
      setDesign({ tierPrices: { A: null, B: null, C: null }, payments: [] });
      setDirty(false);
      toast.success("Schedule removed");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;

  return (
    <section className="border border-rule-strong bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-strong px-4 py-3">
        <div>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">{target.name}</h3>
          {target.arrivalDate && (
            <p className="text-xs text-[color:var(--text-secondary)]">Arrival {fmtDate(target.arrivalDate)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <StatusPill tone="warn">Unsaved changes</StatusPill>
          ) : saved ? (
            <StatusPill tone="good">Saved</StatusPill>
          ) : (
            <StatusPill tone="quiet">No schedule</StatusPill>
          )}
          {template && canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                if (design.payments.length > 0 && !confirm("Replace what's here with the FFX 2027 schedule?")) return;
                update(template);
              }}
            >
              Load FFX 2027
            </Button>
          )}
        </div>
      </div>

      {!saved && startingPoint && startingPointLabel && (
        <p className="border-b border-rule bg-bone px-4 py-2 text-xs">{startingPointLabel}</p>
      )}

      {/* Prices */}
      <div className="border-b border-rule px-4 py-3">
        <p className="text-[13px] font-semibold">Price per tier</p>
        <p className="mb-2 text-xs text-[color:var(--text-secondary)]">
          The full amount a student pays. Leave a tier empty if this school doesn&apos;t offer it.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          {SCHEDULE_TIERS.map((t) => (
            <label key={t} className="text-xs">
              Tier {t}
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                disabled={disabled}
                value={design.tierPrices[t] ?? ""}
                onChange={(e) =>
                  update({ ...design, tierPrices: { ...design.tierPrices, [t]: numOrNull(e.target.value) } })
                }
              />
            </label>
          ))}
        </div>
      </div>

      {/* Payments */}
      <div className="divide-y divide-rule">
        {design.payments.map((p, i) => (
          <PaymentEditor
            key={p.key}
            index={i}
            payment={p}
            count={design.payments.length}
            offered={offered}
            hasArrival={!!target.arrivalDate}
            disabled={disabled}
            trackingOptions={trackingOptions}
            onChange={(patch) => setPayment(i, patch)}
            onMove={(d) => move(i, d)}
            onRemove={() => update({ ...design, payments: design.payments.filter((_, j) => j !== i) })}
          />
        ))}
      </div>
      {canEdit && (
        <div className="border-t border-rule px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              update({
                ...design,
                payments: [
                  ...design.payments,
                  emptyPayment({ label: design.payments.length === 0 ? "Deposit" : "" }),
                ],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add payment
          </Button>
        </div>
      )}

      {/* Check + preview */}
      <div className="border-t border-rule-strong bg-bone px-4 py-3 text-[13px]">
        {compiled.errors.length > 0 && (
          <ul className="mb-2 space-y-0.5 text-destructive">
            {compiled.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {compiled.warnings.length > 0 && (
          <ul className="mb-2 space-y-0.5 text-amber">
            {compiled.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {compiled.tiers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="font-mono uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">
                  <th className="py-1 pr-2">Payment</th>
                  {compiled.tiers.map((t) => (
                    <th key={t.tier} className="py-1 pr-2 text-right">
                      Tier {t.tier}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {design.payments.map((p, i) => (
                  <tr key={p.key} className="border-t border-rule">
                    <td className="py-1 pr-2">{p.label || `Payment ${i + 1}`}</td>
                    {compiled.tiers.map((t) => {
                      const c = t.payments[i];
                      return (
                        <td key={t.tier} className="py-1 pr-2 text-right font-mono">
                          {c.occurrences > 1
                            ? `${c.occurrences} × ${formatZAR(c.perOccurrence)} = ${formatZAR(c.total)}`
                            : formatZAR(c.total)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t border-ink font-semibold">
                  <td className="py-1 pr-2">Total</td>
                  {compiled.tiers.map((t) => (
                    <td
                      key={t.tier}
                      className={`py-1 pr-2 text-right font-mono ${t.difference === 0 ? "" : "text-amber"}`}
                    >
                      {formatZAR(t.total)}
                      {t.difference === 0 ? " ✓" : ` of ${formatZAR(t.price)}`}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {example.length > 0 && tierForPreview && (
          <div className="mt-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">
                Example: a tier {tierForPreview} student accepted today
              </span>
              {offered.length > 1 &&
                offered.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPreviewTier(t)}
                    className={`border px-2 py-0.5 font-mono text-[10px] ${
                      t === tierForPreview ? "border-ink bg-ink text-white" : "border-rule-strong"
                    }`}
                  >
                    {t}
                  </button>
                ))}
            </div>
            <ul className="space-y-0.5 text-xs">
              {example.map((r, k) => (
                <li key={k} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {r.label} — due {fmtDate(r.due_date)}
                    <span className="text-[color:var(--text-secondary)]">
                      {r.status === "needs_decision"
                        ? " · invoice date already passed, would be held for a decision"
                        : ` · invoiced ${fmtDate(r.scheduled_generation_date)}`}
                    </span>
                  </span>
                  <span className="font-mono">{formatZAR(r.amount_zar)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={disabled || !dirty || compiled.errors.length > 0} onClick={() => save()}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save schedule
            </Button>
            {dirty && saved && (
              <Button variant="outline" disabled={disabled} onClick={() => { setDesign(saved); setDirty(false); }}>
                Discard changes
              </Button>
            )}
            {saved && (
              <Button variant="ghost" disabled={disabled} onClick={remove} className="text-destructive">
                Remove schedule
              </Button>
            )}
          </div>
        )}
        {!canEdit && (
          <p className="mt-2 text-xs text-[color:var(--text-secondary)]">Only finance admins can change payment schedules.</p>
        )}
      </div>
    </section>
  );
}

function PaymentEditor({
  index,
  payment: p,
  count,
  offered,
  hasArrival,
  disabled,
  trackingOptions,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  payment: SchedulePayment;
  count: number;
  offered: Tier[];
  hasArrival: boolean;
  disabled: boolean;
  trackingOptions: string[];
  onChange: (patch: Partial<SchedulePayment>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const monthly = p.timing.kind === "monthly";
  const listId = `tracking-${p.key}`;

  const setAmountMode = (mode: PaymentAmount["mode"]) => {
    if (mode === p.amount.mode) return;
    onChange({
      amount:
        mode === "percent"
          ? { mode: "percent", percent: 0 }
          : mode === "fixed"
            ? { mode: "fixed", A: null, B: null, C: null }
            : { mode: "remainder" },
    });
  };

  const setTimingKind = (kind: PaymentTiming["kind"]) => {
    const y = new Date().getUTCFullYear();
    const next: PaymentTiming =
      kind === "after_acceptance"
        ? { kind, days: 0 }
        : kind === "fixed_date"
          ? { kind, date: "" }
          : kind === "before_arrival"
            ? { kind, days: 30 }
            : { kind, count: 10, day: 4, startMonth: 2, startYear: y + 1 };
    // A monthly run usually invoices on the 15th before; a one-off on acceptance.
    const invoice: InvoiceTiming = kind === "monthly" ? { kind: "month_before_15th" } : p.invoice;
    onChange({ timing: next, invoice, amount: kind === "monthly" && p.amount.mode === "remainder" ? { mode: "percent", percent: 0 } : p.amount });
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-[color:var(--text-secondary)]">{index + 1}</span>
        <Input
          className="h-9 max-w-xs"
          placeholder="e.g. Deposit, 2nd payment, Final"
          value={p.label}
          disabled={disabled}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Payment name"
        />
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={disabled || index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={disabled} onClick={onRemove} aria-label="Remove payment">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Amount */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Amount</p>
          <div role="radiogroup" className="inline-flex border border-ink">
            {(
              [
                ["percent", "% of price"],
                ["fixed", "Fixed rand"],
                ...(monthly ? [] : [["remainder", "Whatever's left"]]),
              ] as Array<[PaymentAmount["mode"], string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={p.amount.mode === mode}
                disabled={disabled}
                onClick={() => setAmountMode(mode)}
                className={`px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${
                  p.amount.mode === mode ? "bg-ink text-white" : "hover:bg-bone"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {p.amount.mode === "percent" && (
            <div className="flex items-center gap-2 text-xs">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="h-9 w-24"
                disabled={disabled}
                value={p.amount.percent || ""}
                onChange={(e) => onChange({ amount: { mode: "percent", percent: Number(e.target.value) } })}
                aria-label="Percent of price"
              />
              <span>% of the tier price{monthly ? ", split evenly across the months" : ""}</span>
            </div>
          )}
          {p.amount.mode === "fixed" && (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-2">
                {SCHEDULE_TIERS.map((t) => (
                  <label key={t} className="text-xs">
                    {t}
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-9"
                      disabled={disabled || !offered.includes(t)}
                      value={p.amount.mode === "fixed" ? (p.amount[t] ?? "") : ""}
                      onChange={(e) =>
                        p.amount.mode === "fixed" &&
                        onChange({ amount: { ...p.amount, [t]: numOrNull(e.target.value) } })
                      }
                    />
                  </label>
                ))}
              </div>
              {monthly && <p className="text-xs text-[color:var(--text-secondary)]">Rand amount each month.</p>}
            </div>
          )}
          {p.amount.mode === "remainder" && (
            <p className="text-xs text-[color:var(--text-secondary)]">
              The price minus every other payment, so the total always lands exactly.
            </p>
          )}
        </div>

        {/* Due */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Due</p>
          <select
            className={selectCls}
            disabled={disabled}
            value={p.timing.kind}
            onChange={(e) => setTimingKind(e.target.value as PaymentTiming["kind"])}
            aria-label="When it's due"
          >
            <option value="after_acceptance">Days after they&apos;re accepted</option>
            <option value="fixed_date">On a set date</option>
            {(hasArrival || p.timing.kind === "before_arrival") && (
              <option value="before_arrival">Days before arrival</option>
            )}
            <option value="monthly">Monthly run</option>
          </select>
          {(p.timing.kind === "after_acceptance" || p.timing.kind === "before_arrival") && (
            <div className="flex items-center gap-2 text-xs">
              <Input
                type="number"
                min="0"
                className="h-9 w-20"
                disabled={disabled}
                value={p.timing.days}
                onChange={(e) =>
                  onChange({ timing: { kind: p.timing.kind as "after_acceptance", days: Math.max(0, Number(e.target.value) || 0) } })
                }
                aria-label="Days"
              />
              <span>
                {p.timing.kind === "after_acceptance"
                  ? p.timing.days === 0
                    ? "days (0 = the day they're accepted)"
                    : "days after acceptance"
                  : p.timing.days === 0
                    ? "days (0 = on arrival day)"
                    : "days before arrival"}
              </span>
            </div>
          )}
          {p.timing.kind === "fixed_date" && (
            <div className="w-[160px]">
              <DateInput
                value={p.timing.date}
                disabled={disabled}
                onChange={(iso) => onChange({ timing: { kind: "fixed_date", date: iso } })}
                aria-label="Due date"
              />
            </div>
          )}
          {p.timing.kind === "monthly" && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Input
                type="number"
                min="1"
                className="h-9 w-16"
                disabled={disabled}
                value={p.timing.count}
                onChange={(e) => p.timing.kind === "monthly" && onChange({ timing: { ...p.timing, count: Number(e.target.value) } })}
                aria-label="Number of months"
              />
              <span>payments on day</span>
              <Input
                type="number"
                min="1"
                max="28"
                className="h-9 w-16"
                disabled={disabled}
                value={p.timing.day}
                onChange={(e) => p.timing.kind === "monthly" && onChange({ timing: { ...p.timing, day: Number(e.target.value) } })}
                aria-label="Day of month"
              />
              <span>from</span>
              <select
                className={selectCls}
                disabled={disabled}
                value={p.timing.startMonth}
                onChange={(e) => p.timing.kind === "monthly" && onChange({ timing: { ...p.timing, startMonth: Number(e.target.value) } })}
                aria-label="First month"
              >
                {MONTHS.map((m, k) => (
                  <option key={m} value={k + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                className="h-9 w-20"
                disabled={disabled}
                value={p.timing.startYear}
                onChange={(e) => p.timing.kind === "monthly" && onChange({ timing: { ...p.timing, startYear: Number(e.target.value) } })}
                aria-label="First year"
              />
            </div>
          )}
        </div>

        {/* Invoice */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Invoice created</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              className={selectCls}
              disabled={disabled}
              value={p.invoice.kind}
              onChange={(e) => {
                const kind = e.target.value as InvoiceTiming["kind"];
                onChange({ invoice: kind === "days_before_due" ? { kind, days: 14 } : { kind } });
              }}
              aria-label="When the invoice is created"
            >
              <option value="on_acceptance">As soon as they&apos;re accepted</option>
              <option value="month_before_15th">On the 15th of the month before it&apos;s due</option>
              <option value="days_before_due">Days before it&apos;s due</option>
            </select>
            {p.invoice.kind === "days_before_due" && (
              <Input
                type="number"
                min="0"
                className="h-9 w-20"
                disabled={disabled}
                value={p.invoice.days}
                onChange={(e) => onChange({ invoice: { kind: "days_before_due", days: Math.max(0, Number(e.target.value) || 0) } })}
                aria-label="Days before due"
              />
            )}
          </div>
        </div>

        {/* Xero */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Xero</p>
          <div className="grid grid-cols-3 gap-2">
            {SCHEDULE_TIERS.map((t) => (
              <label key={t} className="text-xs">
                Item code {t}
                <Input
                  className="h-9 font-mono text-xs"
                  disabled={disabled || !offered.includes(t)}
                  value={p.itemCodes[t] ?? ""}
                  onChange={(e) => onChange({ itemCodes: { ...p.itemCodes, [t]: e.target.value || null } })}
                />
              </label>
            ))}
          </div>
          <label className="block text-xs">
            &ldquo;Schools&rdquo; tracking
            <Input
              className="h-9"
              list={listId}
              placeholder="e.g. Gap Year 2027"
              disabled={disabled}
              value={p.trackingOption ?? ""}
              onChange={(e) => onChange({ trackingOption: e.target.value || null })}
            />
            <datalist id={listId}>
              {trackingOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
        </div>
      </div>
    </div>
  );
}
