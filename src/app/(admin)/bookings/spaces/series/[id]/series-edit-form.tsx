"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarPlus, CalendarX2, Lock } from "lucide-react";
import { WEEKDAY_OPTIONS, RECURRENCE_INTERVAL_OPTIONS, weekdayLabel } from "@/lib/bookings/recurrence";
import { humanDate, todayISO } from "@/lib/bookings/dates";
import type { Venue, Ministry, BookingSeries, Booking } from "@/services/bookings";
import { SectionBar } from "@/components/ffsa";
import { ClashPanel, overrideBody, type ClashConflict as Conflict } from "../../clash-panel";

type Plan = {
  add: string[];
  remove: { id: string; date: string }[];
  keep: number;
  frozen: number;
};

function timeVal(t: string | null): string {
  if (!t) return "";
  const m = t.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function SeriesEditForm({
  series,
  occurrences,
  venues,
  ministries,
  canApprove,
}: {
  series: BookingSeries;
  occurrences: Booking[];
  venues: Venue[];
  ministries: Ministry[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [canOverride, setCanOverride] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");

  const [form, setForm] = useState({
    venue_id: series.venue_id,
    ministry_id: series.ministry_id ?? "none",
    title: series.title,
    description: series.description ?? "",
    point_person: series.point_person ?? "",
    weekday: String(series.weekday),
    series_start: series.series_start,
    series_end: series.series_end,
    interval_weeks: String(series.interval_weeks ?? 1),
    start_time: timeVal(series.start_time),
    end_time: timeVal(series.end_time),
    setup_time: timeVal(series.setup_time),
    setdown_time: timeVal(series.setdown_time),
  });

  const today = todayISO();
  const past = useMemo(
    () => occurrences.filter((o) => o.booking_date <= today).length,
    [occurrences, today]
  );

  // Somewhere sensible to land after saving: the next date still to come.
  const returnId = useMemo(() => {
    const next = occurrences.find((o) => o.booking_date > today);
    return (next ?? occurrences[occurrences.length - 1])?.id ?? null;
  }, [occurrences, today]);

  function update(field: keyof typeof form, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    // Any change invalidates the plan we showed for the previous one.
    if (plan) setPlan(null);
    if (conflicts.length) setConflicts([]);
    if (blocked) setBlocked(false);
    if (overriding) setOverriding(false);
    if (reason) setReason("");
    if (error) setError(null);
  }

  function validate(): string | null {
    if (!form.venue_id) return "Please choose a venue.";
    if (!form.title.trim()) return "Please enter an event name.";
    if (form.weekday === "") return "Please choose a day of the week.";
    if (!form.series_start || !form.series_end) return "Please set the first and last dates.";
    if (form.series_end < form.series_start) return "The last date must be on or after the first date.";
    return null;
  }

  function payload(dryRun: boolean) {
    return {
      dryRun,
      ...(dryRun ? {} : overrideBody(overriding, reason)),
      venue_id: form.venue_id,
      ministry_id: form.ministry_id === "none" ? null : form.ministry_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      point_person: form.point_person.trim() || null,
      weekday: parseInt(form.weekday, 10),
      series_start: form.series_start,
      series_end: form.series_end,
      interval_weeks: parseInt(form.interval_weeks, 10),
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      setup_time: form.setup_time || null,
      setdown_time: form.setdown_time || null,
    };
  }

  async function send(dryRun: boolean) {
    const res = await fetch(`/api/bookings/series/${series.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(dryRun)),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json } as {
      ok: boolean;
      json: {
        error?: string;
        plan?: Plan;
        conflicts?: Conflict[];
        blocked?: boolean;
        canOverride?: boolean;
        reopened?: boolean;
      };
    };
  }

  // Two steps on purpose: nobody should reshape a term's worth of bookings
  // without first being told exactly which dates appear and which disappear.
  async function submit(confirmed: boolean) {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);

    if (!confirmed) {
      const dry = await send(true);
      if (!dry.ok) {
        setError(dry.json.error ?? "Could not work out the new dates.");
        setLoading(false);
        return;
      }
      setPlan(dry.json.plan ?? null);
      setConflicts(dry.json.conflicts ?? []);
      setBlocked(!!dry.json.blocked);
      setCanOverride(!!dry.json.canOverride);
      setLoading(false);
      return;
    }
    if (blocked && !(overriding && reason.trim())) {
      setLoading(false);
      return;
    }

    const res = await send(false);
    if (!res.ok) {
      if (res.json.blocked) {
        // Someone holds the space at some of those times (perhaps since the check).
        setConflicts(res.json.conflicts ?? []);
        setBlocked(true);
        setCanOverride(!!res.json.canOverride);
        setOverriding(false);
        setReason("");
      } else {
        setError(res.json.error ?? "Could not update the series.");
      }
      setLoading(false);
      return;
    }

    const p = res.json.plan;
    const bits: string[] = [];
    if (p?.add.length) bits.push(`${p.add.length} date${p.add.length === 1 ? "" : "s"} added`);
    if (p?.remove.length) bits.push(`${p.remove.length} removed`);
    toast.success(
      bits.length ? `Series updated — ${bits.join(", ")}.` : "Series updated.",
      res.json.reopened
        ? { description: "This space needs approval, so the changed dates went back to its manager." }
        : undefined
    );

    router.push(returnId ? `/bookings/spaces/${returnId}` : "/bookings/spaces");
    router.refresh();
  }

  const nothingChanges =
    plan !== null && plan.add.length === 0 && plan.remove.length === 0;

  return (
    <div className="space-y-5">
      <div className="border border-ink bg-white">
        <SectionBar title="The whole series" />
        <div className="p-6">
          <p className="mb-5 border border-rule bg-bone px-3 py-2.5 text-xs text-[color:var(--text-secondary)]">
            Currently{" "}
            <span className="text-[color:var(--text-primary)]">
              {(series.interval_weeks ?? 1) > 1
                ? `every other ${weekdayLabel(series.weekday)}`
                : `every ${weekdayLabel(series.weekday)}`}
            </span>
            ,{" "}
            {humanDate(series.series_start)} – {humanDate(series.series_end)} · {occurrences.length}{" "}
            date{occurrences.length === 1 ? "" : "s"}.
            {past > 0 && (
              <>
                {" "}
                <span className="text-[color:var(--text-primary)]">
                  {past} {past === 1 ? "date has" : "dates have"} already happened
                </span>{" "}
                and won&apos;t be changed.
              </>
            )}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(plan !== null);
            }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Venue *</Label>
                <Select value={form.venue_id || undefined} onValueChange={(v) => update("venue_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a venue" />
                  </SelectTrigger>
                  <SelectContent>
                    {venues.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Ministry</Label>
                <Select value={form.ministry_id} onValueChange={(v) => update("ministry_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Ministry" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No ministry</SelectItem>
                    {ministries.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Event name *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Event description</Label>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={2}
                className="flex w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="point_person">Point person</Label>
              <Input
                id="point_person"
                value={form.point_person}
                onChange={(e) => update("point_person", e.target.value)}
                placeholder="On-the-day contact"
              />
            </div>

            {/* The schedule — the part you couldn't change before */}
            <div className="space-y-3 border border-rule bg-bone p-4">
              <span className="mono-label">When it runs</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                  <Label>Repeats every</Label>
                  <Select value={form.interval_weeks} onValueChange={(v) => update("interval_weeks", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_INTERVAL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Day of week *</Label>
                  <Select value={form.weekday} onValueChange={(v) => update("weekday", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a day" />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={String(d.value)}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Runs from *</Label>
                  <DateField
                    value={form.series_start}
                    onChange={(v) => update("series_start", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Runs until *</Label>
                  <DateField
                    value={form.series_end}
                    onChange={(v) => update("series_end", v)}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <span className="mono-label">Times &amp; set-up</span>
              <span className="h-px flex-1 bg-rule" />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ["start_time", "Event start"],
                  ["end_time", "Event end"],
                  ["setup_time", "Set-up"],
                  ["setdown_time", "Set-down"],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={field}>{label}</Label>
                  <Input
                    id={field}
                    type="time"
                    value={form[field]}
                    onChange={(e) => update(field, e.target.value)}
                  />
                </div>
              ))}
            </div>

            {/* What the change will actually do */}
            {plan && (
              <div className="space-y-2 border border-ink p-3 text-sm">
                <p className="font-semibold">Here&apos;s what will change</p>
                {nothingChanges ? (
                  <p className="text-[color:var(--text-secondary)]">
                    The dates stay exactly as they are — only the details below them change.
                  </p>
                ) : (
                  <ul className="space-y-1 text-[color:var(--text-secondary)]">
                    {plan.add.length > 0 && (
                      <li className="flex gap-2">
                        <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="text-[color:var(--text-primary)]">
                            {plan.add.length} new date{plan.add.length === 1 ? "" : "s"}
                          </span>{" "}
                          — {plan.add.slice(0, 4).map(humanDate).join(", ")}
                          {plan.add.length > 4 ? `, +${plan.add.length - 4} more` : ""}
                        </span>
                      </li>
                    )}
                    {plan.remove.length > 0 && (
                      <li className="flex gap-2">
                        <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="text-[color:var(--text-primary)]">
                            {plan.remove.length} date{plan.remove.length === 1 ? "" : "s"} removed
                          </span>{" "}
                          — {plan.remove.slice(0, 4).map((r) => humanDate(r.date)).join(", ")}
                          {plan.remove.length > 4 ? `, +${plan.remove.length - 4} more` : ""}
                        </span>
                      </li>
                    )}
                  </ul>
                )}
                <p className="flex gap-2 text-[color:var(--text-secondary)]">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {plan.keep} date{plan.keep === 1 ? "" : "s"} kept as {plan.keep === 1 ? "it is" : "they are"}
                    {plan.frozen > 0
                      ? `, and ${plan.frozen} past date${plan.frozen === 1 ? "" : "s"} left alone.`
                      : "."}
                  </span>
                </p>
              </div>
            )}

            {conflicts.length > 0 && (
              <ClashPanel
                conflicts={conflicts}
                venueName={venues.find((v) => v.id === form.venue_id)?.name}
                canOverride={canOverride}
                overriding={overriding}
                onOverridingChange={setOverriding}
                reason={reason}
                onReasonChange={setReason}
              />
            )}
            {blocked && !overriding && (
              <p className="text-xs text-[color:var(--text-secondary)]">
                Pick a day or time that doesn&apos;t overlap, then check again. Back-to-back is fine.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                type="submit"
                className="min-h-11"
                disabled={loading || (blocked && !(overriding && reason.trim()))}
              >
                {loading
                  ? "Working…"
                  : blocked
                    ? overriding
                      ? "Book anyway"
                      : "Time taken"
                    : plan
                      ? "Save series"
                      : "Check the dates"}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
            {!plan && !blocked && (
              <p className="text-xs text-[color:var(--text-secondary)]">
                You&apos;ll see exactly which dates are added or removed before anything is saved.
                {!canApprove && " Changing the venue or time may send the series back for approval."}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
