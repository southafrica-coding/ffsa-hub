"use client";

// The Schedule screen's controls (the Fleet app's km-log button, the weekly-only switch,
// schedSettingsHTML + saveSchedule and notifyHTML + saveNotify). Only rendered for people
// who can manage Fleet; the routes check that again.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { fmtDate, weekStartOf } from "@/lib/fleet/rules/format";
import { cn } from "@/lib/utils/cn";
import { fleetFetch } from "../_components/client-api";
import { KmDialog, type KmVehicle } from "../_components/km-dialog";
import { ActionButton } from "../_components/ui";
import {
  BUDGET_HOURS,
  DAYS_LONG,
  DAYS_SHORT,
  MAX_CHOICES,
  changedDays,
  dayLoads,
  scheduleError,
  setWeeklyOnlyList,
  settingsBody,
  type ScheduleForm,
} from "./model";

const linkBtn = "inline-flex min-h-11 items-center px-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline";
const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none";
const label = "mono-label mb-1.5 block";

/** "Log km" on a row of Services and inspections by km. */
export function LogKmLink({ vehicle, today }: { vehicle: KmVehicle; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={linkBtn} onClick={() => setOpen(true)} aria-label={`Log km for ${vehicle.name}`}>
        Log km
      </button>
      {open && <KmDialog open={open} onOpenChange={setOpen} vehicle={vehicle} today={today} />}
    </>
  );
}

async function saveWeeklyOnly(list: string[]) {
  await fleetFetch("/api/vehicles/fleet/settings", { method: "PATCH", body: { weeklyOnly: list } });
  await fleetFetch("/api/vehicles/fleet/time", { body: { kind: "admin", mins: 1 } }).catch(() => {});
}

/** "Weekly checks only this week (the monthly check moves to the next week)". */
export function WeeklyOnlySwitch({ ws, list, today, on }: { ws: string; list: string[]; today: string; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(on);
  async function change(next: boolean) {
    setBusy(true);
    setChecked(next);
    try {
      await saveWeeklyOnly(setWeeklyOnlyList(list, ws, next, today));
      toast.success(next ? "Weekly checks only that week. The monthly checks move to the next week." : "Monthly checks are back on for that week.");
      router.refresh();
    } catch (e) {
      setChecked(!next);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
      <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={checked} disabled={busy} onChange={(e) => change(e.target.checked)} />
      <span>Weekly checks only this week (the monthly check moves to the next week)</span>
    </label>
  );
}

/** Weekly-only weeks further ahead: remove one, or add another week. */
export function WeeklyOnlyWeeks({ weeks, list, today }: { weeks: { ws: string; text: string }[]; list: string[]; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(ws: string, on: boolean) {
    setBusy(true);
    try {
      await saveWeeklyOnly(setWeeklyOnlyList(list, ws, on, today));
      toast.success(on ? "Weekly checks only that week. The monthly checks move to the next week." : "Monthly checks are back on for that week.");
      setDate("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ws = date ? weekStartOf(date) : "";
  return (
    <div className="space-y-3">
      {weeks.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule">
          {weeks.map((w) => (
            <li key={w.ws} className="flex flex-wrap items-center justify-between gap-x-3 py-1 text-[14px]">
              <span>{w.text}</span>
              <button type="button" className={linkBtn} disabled={busy} onClick={() => go(w.ws, false)}>
                Monthly checks back on
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-48">
          <span className={label}>Another week (pick any day in it)</span>
          <input type="date" className={field} value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <ActionButton onClick={() => ws && go(ws, true)} disabled={busy || !ws || list.includes(ws)}>
          Weekly checks only
        </ActionButton>
      </div>
      {ws && (
        <p className="text-[13px] text-[#55524A]">
          {list.includes(ws) ? `The week of ${fmtDate(ws)} is already weekly checks only.` : `The week of ${fmtDate(ws)} (Monday).`}
        </p>
      )}
    </div>
  );
}

export interface AssignRow {
  id: string;
  name: string;
  reg: string | null;
}

/** Inspection days, most per day, time budget and each vehicle's check day. */
export function ScheduleSettings({
  initial,
  stored,
  vehicles,
  saved,
}: {
  initial: ScheduleForm;
  /** Each vehicle's stored check day, to send only the ones that changed. */
  stored: Record<string, number | null>;
  vehicles: AssignRow[];
  saved: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<ScheduleForm>(initial);
  const [busy, setBusy] = useState(false);
  const err = scheduleError(f);
  const load = dayLoads(f);
  const budgets = BUDGET_HOURS.includes(f.budgetHours) ? BUDGET_HOURS : [...BUDGET_HOURS, f.budgetHours].sort((a, b) => a - b);
  const maxes = MAX_CHOICES.includes(f.max) ? MAX_CHOICES : [...MAX_CHOICES, f.max].sort((a, b) => a - b);

  const toggleDay = (d: number, on: boolean) => setF({ ...f, days: on ? [...f.days, d].sort((a, b) => a - b) : f.days.filter((x) => x !== d) });

  async function save() {
    if (err) return toast.error(err);
    setBusy(true);
    try {
      await fleetFetch("/api/vehicles/fleet/settings", { method: "PATCH", body: settingsBody(f) });
      for (const c of changedDays(stored, f))
        await fleetFetch(`/api/vehicles/fleet/vehicles/${c.id}`, { method: "PATCH", body: { patch: { inspectionDay: c.day } } });
      toast.success("Schedule saved.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-5 py-5 md:px-8">
      <fieldset>
        <legend className={label}>Days of the week</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS_SHORT.map((n, i) => {
            const d = i + 1;
            const on = f.days.includes(d);
            return (
              <label
                key={n}
                className={cn(
                  "flex min-h-11 min-w-[56px] cursor-pointer items-center justify-center gap-2 border px-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em]",
                  on ? "border-ink bg-ink text-white" : "border-rule-strong bg-white text-ink"
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} onChange={(e) => toggleDay(d, e.target.checked)} aria-label={DAYS_LONG[i]} />
                {n}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Most vehicles per day</span>
          <select className={field} value={f.max} onChange={(e) => setF({ ...f, max: Number(e.target.value) })}>
            {maxes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Time budget per week</span>
          <select className={field} value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: Number(e.target.value) })}>
            {budgets.map((n) => (
              <option key={n} value={n}>
                {n} hours
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[#7C786C]">Inspections plus bookings and admin</span>
        </label>
      </div>

      <div>
        <span className={label}>Inspection day for each vehicle</span>
        <ul className="divide-y divide-rule border-y border-rule">
          {vehicles.map((v) => (
            <li key={v.id} className="grid grid-cols-1 gap-1.5 py-2.5 sm:grid-cols-[1fr_220px] sm:items-center sm:gap-4">
              <span className="text-[14px]">
                {v.name} {v.reg && <span className="text-[12px] text-[#7C786C]">{v.reg}</span>}
              </span>
              <select
                className={field}
                aria-label={`Inspection day for ${v.name}`}
                value={f.assign[v.id] ?? ""}
                onChange={(e) => setF({ ...f, assign: { ...f.assign, [v.id]: e.target.value ? Number(e.target.value) : null } })}
              >
                <option value="">Not scheduled</option>
                {DAYS_LONG.map((n, i) => (
                  <option key={n} value={i + 1}>
                    {n}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-[#55524A]">
          {f.days.map((d) => `${DAYS_LONG[d - 1]}: ${load[d] || 0} of ${f.max}`).join(" · ")}
        </p>
      </div>

      {err && (
        <p role="alert" className="border-l-[3px] border-destructive pl-3 text-[14px]">
          {err}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ActionButton tone="solid" onClick={save} disabled={busy}>
          Save schedule
        </ActionButton>
        {!saved && <span className="text-[13px] text-[#7C786C]">Suggested days; save to keep them.</span>}
      </div>
    </div>
  );
}

/** Reminder by email / Slack on or off. They go to whoever holds the Vehicle Coordinator role. */
export function ReminderSettings({ initial }: { initial: { email: boolean; slack: boolean } }) {
  const router = useRouter();
  const [n, setN] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await fleetFetch("/api/vehicles/fleet/settings", { method: "PATCH", body: { notify: n } });
      toast.success("Reminder settings saved.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const box = "flex min-h-11 cursor-pointer items-center gap-3 text-[14px]";
  return (
    <div className="space-y-1">
      <label className={box}>
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={n.email} onChange={(e) => setN({ ...n, email: e.target.checked })} />
        Send the daily reminder by email
      </label>
      <label className={box}>
        <input type="checkbox" className="h-5 w-5 shrink-0 accent-ink" checked={n.slack} onChange={(e) => setN({ ...n, slack: e.target.checked })} />
        Also put it in the 07:00 vehicles message on Slack
      </label>
      <div className="pt-2">
        <ActionButton onClick={save} disabled={busy}>
          Save reminder settings
        </ActionButton>
      </div>
    </div>
  );
}
