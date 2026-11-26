"use client";

import { useState } from "react";
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
import { CheckCircle2, Clock } from "lucide-react";
import { WEEKDAY_OPTIONS } from "@/lib/bookings/recurrence";
import type { Venue, Ministry } from "@/services/bookings";
import { SectionBar } from "@/components/ffsa";
import { ClashPanel, overrideBody, type ClashConflict as Conflict } from "./clash-panel";

export function BookingForm({
  venues,
  ministries,
  defaultRequesterName,
  defaultDate = "",
  defaultVenueId = "",
  defaultStart = "",
  defaultEnd = "",
  canApprove = false,
}: {
  venues: Venue[];
  ministries: Ministry[];
  defaultRequesterName: string;
  /** Seeded from a click on the calendar — the day, lane and slot you clicked. */
  defaultDate?: string;
  defaultVenueId?: string;
  defaultStart?: string;
  defaultEnd?: string;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  // A clash is refused on every space. A space manager can still book over it
  // with a reason ("Book anyway" in the clash panel).
  const [blocked, setBlocked] = useState(false);
  const [canOverride, setCanOverride] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");

  const [form, setForm] = useState({
    venue_id: defaultVenueId || venues[0]?.id || "",
    ministry_id: "none",
    title: "",
    description: "",
    point_person: "",
    requester_name: defaultRequesterName,
    recurrence: "none" as "none" | "weekly" | "biweekly",
    booking_date: defaultDate,
    end_date: "",
    weekday: "",
    series_start: "",
    series_end: "",
    start_time: defaultStart,
    end_time: defaultEnd,
    setup_time: "",
    setdown_time: "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Any change invalidates the previous clash check.
    if (conflicts.length) setConflicts([]);
    if (blocked) setBlocked(false);
    if (overriding) setOverriding(false);
    if (reason) setReason("");
    if (error) setError(null);
  }

  function showClash(json: { conflicts?: Conflict[]; canOverride?: boolean }) {
    setConflicts(json.conflicts ?? []);
    setBlocked(true);
    setCanOverride(!!json.canOverride);
  }

  const selectedVenue = venues.find((v) => v.id === form.venue_id);
  // Two separate facts, kept apart on purpose. The SPACE either needs approval
  // or it doesn't — that never changes with who is looking. What changes is
  // what happens to THIS booking: a manager's own request auto-confirms even
  // on a held space. Collapsing the two told a manager "this space doesn't
  // need approval" about a space that does.
  const venueNeedsApproval = selectedVenue?.requires_approval ?? false;
  const willAutoConfirm = canApprove || !venueNeedsApproval;

  function validate(): string | null {
    if (!form.venue_id) return "Please choose a venue.";
    if (!form.title.trim()) return "Please enter an event name.";
    if (form.recurrence !== "none") {
      if (form.weekday === "") return "Please choose a day of the week.";
      if (!form.series_start || !form.series_end) return "Please set the start and end dates of the recurring run.";
      if (form.series_end < form.series_start) return "The recurring end date must be on or after the start date.";
    } else {
      if (!form.booking_date) return "Please choose a date.";
      if (form.end_date && form.end_date < form.booking_date) return "The end date must be on or after the start date.";
    }
    return null;
  }

  function payload(dryRun: boolean) {
    const isRecurring = form.recurrence !== "none";
    return {
      dryRun,
      ...(dryRun ? {} : overrideBody(overriding, reason)),
      venue_id: form.venue_id,
      ministry_id: form.ministry_id === "none" ? null : form.ministry_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      point_person: form.point_person.trim() || null,
      requester_name: form.requester_name.trim() || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      setup_time: form.setup_time || null,
      setdown_time: form.setdown_time || null,
      recurrence: isRecurring ? "weekly" : "none",
      ...(isRecurring
        ? {
            weekday: parseInt(form.weekday, 10),
            series_start: form.series_start,
            series_end: form.series_end,
            interval_weeks: form.recurrence === "biweekly" ? 2 : 1,
          }
        : { booking_date: form.booking_date, end_date: form.end_date || null }),
    };
  }

  async function post(dryRun: boolean) {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(dryRun)),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json } as {
      ok: boolean;
      json: {
        error?: string;
        conflicts?: Conflict[];
        bookingId?: string;
        count?: number;
        autoConfirm?: boolean;
        blocked?: boolean;
        canOverride?: boolean;
      };
    };
  }

  async function submit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (blocked && !(overriding && reason.trim())) return;
    setLoading(true);
    setError(null);

    // Step 1: clash check (skipped once a manager has chosen to book over it).
    if (!blocked) {
      const dry = await post(true);
      if (!dry.ok) {
        setError(dry.json.error ?? "Could not check availability.");
        setLoading(false);
        return;
      }
      if (dry.json.conflicts && dry.json.conflicts.length > 0) {
        showClash(dry.json);
        setLoading(false);
        return;
      }
    }

    // Step 2: create.
    const res = await post(false);
    if (!res.ok) {
      // 409: someone holds the space (perhaps booked since the check).
      if (res.json.blocked) {
        showClash(res.json);
        setOverriding(false);
        setReason("");
      } else {
        setError(res.json.error ?? "Could not submit the booking.");
      }
      setLoading(false);
      return;
    }

    const confirmed = res.json.autoConfirm;
    if (res.json.count && res.json.count > 1) {
      toast.success(
        confirmed
          ? `Recurring booking confirmed (${res.json.count} dates).`
          : `Recurring booking submitted for approval (${res.json.count} dates).`
      );
    } else if (confirmed) {
      toast.success("Booking confirmed.");
    } else {
      toast.success("Booking request submitted for approval.");
    }

    router.push(res.json.bookingId ? `/bookings/spaces/${res.json.bookingId}` : "/bookings/spaces");
    router.refresh();
  }

  const hasConflicts = conflicts.length > 0;

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Booking details" />
      <div className="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          {/* Venue + ministry */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              {selectedVenue &&
                (venueNeedsApproval && canApprove ? (
                  <p className="flex items-center gap-1.5 text-xs text-grass-text">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    This space needs approval — yours confirms straight away
                    because you&apos;re a booking manager.
                  </p>
                ) : willAutoConfirm ? (
                  <p className="flex items-center gap-1.5 text-xs text-grass-text">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Instant confirmation — this space doesn&apos;t need approval.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-amber">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Goes to the booking manager for approval.
                  </p>
                ))}
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

          {/* Event details */}
          <div className="space-y-2">
            <Label htmlFor="title">Event name *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Jesus Night (High School)"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="point_person">Point person</Label>
              <Input
                id="point_person"
                value={form.point_person}
                onChange={(e) => update("point_person", e.target.value)}
                placeholder="On-the-day contact"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requester_name">Requested by</Label>
              <Input
                id="requester_name"
                value={form.requester_name}
                onChange={(e) => update("requester_name", e.target.value)}
              />
            </div>
          </div>

          {/* When */}
          <div className="space-y-3 border border-rule bg-bone p-4">
            <div className="flex w-fit items-center">
              {(["none", "weekly", "biweekly"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className="chip -ml-px bg-white"
                  data-active={form.recurrence === r ? "true" : undefined}
                  onClick={() => update("recurrence", r)}
                >
                  {r === "none" ? "One-off" : r === "weekly" ? "Weekly" : "Bi-weekly"}
                </button>
              ))}
            </div>

            {form.recurrence === "none" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <DateField
                    value={form.booking_date}
                    onChange={(v) => update("booking_date", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End date (multi-day)</Label>
                  <DateField
                    value={form.end_date}
                    onChange={(v) => update("end_date", v)}
                  />
                </div>
              </div>
            ) : /* weekly or biweekly — same date-range fields */ (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Day of week *</Label>
                  <Select
                    value={form.weekday === "" ? undefined : form.weekday}
                    onValueChange={(v) => update("weekday", v)}
                  >
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
            )}
          </div>

          {/* Times */}
          <div className="flex items-center gap-3 pt-1">
            <span className="mono-label">
              Times &amp; set-up
            </span>
            <span className="h-px flex-1 bg-rule" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Event start</Label>
              <Input
                id="start_time"
                type="time"
                value={form.start_time}
                onChange={(e) => update("start_time", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">Event end</Label>
              <Input
                id="end_time"
                type="time"
                value={form.end_time}
                onChange={(e) => update("end_time", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup_time">Set-up</Label>
              <Input
                id="setup_time"
                type="time"
                value={form.setup_time}
                onChange={(e) => update("setup_time", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setdown_time">Set-down</Label>
              <Input
                id="setdown_time"
                type="time"
                value={form.setdown_time}
                onChange={(e) => update("setdown_time", e.target.value)}
              />
            </div>
          </div>

          {/* Clash — refused on every space; managers can book over it with a reason */}
          {hasConflicts && (
            <ClashPanel
              conflicts={conflicts}
              venueName={selectedVenue?.name}
              canOverride={canOverride}
              overriding={overriding}
              onOverridingChange={setOverriding}
              reason={reason}
              onReasonChange={setReason}
            />
          )}
          {hasConflicts && !overriding && (
            <p className="text-xs text-[color:var(--text-secondary)]">
              Change the date, time or space above and try again. Back-to-back is fine.
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
                  : willAutoConfirm
                    ? "Confirm booking"
                    : "Submit request"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
