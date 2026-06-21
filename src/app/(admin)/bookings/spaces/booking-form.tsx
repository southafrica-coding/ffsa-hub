"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Ban, CheckCircle2, Clock } from "lucide-react";
import { WEEKDAY_OPTIONS } from "@/lib/bookings/recurrence";
import { humanDate } from "@/lib/bookings/dates";
import type { Venue, Ministry } from "@/services/bookings";

type Conflict = {
  date: string;
  existingId: string;
  existingTitle: string;
  existingTime?: string;
  occupiedUntil?: string;
  who?: string | null;
};

export function BookingForm({
  venues,
  ministries,
  defaultRequesterName,
  defaultDate = "",
  canApprove = false,
}: {
  venues: Venue[];
  ministries: Ministry[];
  defaultRequesterName: string;
  defaultDate?: string;
  canApprove?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  // True when the clash is on an auto-confirm space — a hard block, not a warning.
  const [blocked, setBlocked] = useState(false);

  const [form, setForm] = useState({
    venue_id: venues[0]?.id ?? "",
    ministry_id: "none",
    title: "",
    description: "",
    point_person: "",
    requester_name: defaultRequesterName,
    recurrence: "none" as "none" | "weekly",
    booking_date: defaultDate,
    end_date: "",
    weekday: "",
    series_start: "",
    series_end: "",
    start_time: "",
    end_time: "",
    setup_time: "",
    setdown_time: "",
  });

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Any change invalidates the previous clash check.
    if (conflicts.length) setConflicts([]);
    if (blocked) setBlocked(false);
    if (error) setError(null);
  }

  const selectedVenue = venues.find((v) => v.id === form.venue_id);
  // What happens to THIS booking on submit: managers always auto-confirm; for
  // everyone else it depends on the space's approval setting.
  const willAutoConfirm = canApprove || !(selectedVenue?.requires_approval ?? false);

  function validate(): string | null {
    if (!form.venue_id) return "Please choose a venue.";
    if (!form.title.trim()) return "Please enter an event name.";
    if (form.recurrence === "weekly") {
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
    return {
      dryRun,
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
      recurrence: form.recurrence,
      ...(form.recurrence === "weekly"
        ? {
            weekday: parseInt(form.weekday, 10),
            series_start: form.series_start,
            series_end: form.series_end,
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
      };
    };
  }

  async function submit(force: boolean) {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);

    // Step 1: clash check (unless the user already chose to book anyway).
    if (!force) {
      const dry = await post(true);
      if (!dry.ok) {
        setError(dry.json.error ?? "Could not check availability.");
        setLoading(false);
        return;
      }
      if (dry.json.conflicts && dry.json.conflicts.length > 0) {
        setConflicts(dry.json.conflicts);
        // On auto-confirm spaces a clash is a hard block (no "Book anyway").
        setBlocked(!!dry.json.blocked);
        setLoading(false);
        return;
      }
    }

    // Step 2: create.
    const res = await post(false);
    if (!res.ok) {
      // A 409 means the server blocked a double-booking on an auto-confirm space.
      if (res.json.blocked && res.json.conflicts) {
        setConflicts(res.json.conflicts);
        setBlocked(true);
      }
      setError(res.json.error ?? "Could not submit the booking.");
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
    <Card>
      <CardContent className="pt-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(hasConflicts);
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
                (willAutoConfirm ? (
                  <p className="flex items-center gap-1.5 text-xs text-[hsl(142_52%_55%)]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Instant confirmation — this space doesn&apos;t need approval.
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-[hsl(42_95%_60%)]">
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
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center rounded-md border bg-card p-0.5 w-fit">
              {(["none", "weekly"] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant={form.recurrence === r ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-3"
                  onClick={() => update("recurrence", r)}
                >
                  {r === "none" ? "One-off" : "Weekly"}
                </Button>
              ))}
            </div>

            {form.recurrence === "none" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date *</Label>
                  <DateInput
                    value={form.booking_date}
                    onChange={(v) => update("booking_date", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End date (multi-day)</Label>
                  <DateInput
                    value={form.end_date}
                    onChange={(v) => update("end_date", v)}
                  />
                </div>
              </div>
            ) : (
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
                  <DateInput
                    value={form.series_start}
                    onChange={(v) => update("series_start", v)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Runs until *</Label>
                  <DateInput
                    value={form.series_end}
                    onChange={(v) => update("series_end", v)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Times */}
          <div className="flex items-center gap-3 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(30_6%_46%)]">
              Times &amp; set-up
            </span>
            <span className="h-px flex-1 bg-[hsl(22_8%_14%)]" />
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

          {/* Clash — a hard BLOCK on auto-confirm spaces, a warning otherwise */}
          {hasConflicts && (
            <div
              className={
                blocked
                  ? "rounded-lg border border-destructive/45 bg-destructive/10 p-3 text-sm"
                  : "rounded-lg border border-primary/35 bg-primary/10 p-3 text-sm"
              }
            >
              <p
                className={
                  blocked
                    ? "flex items-center gap-2 font-semibold text-destructive"
                    : "flex items-center gap-2 font-semibold text-primary"
                }
              >
                {blocked ? <Ban className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {blocked
                  ? "This space is already booked at that time"
                  : `This ${form.recurrence === "weekly" ? "series clashes" : "booking clashes"} with an existing booking in this venue`}
              </p>
              <ul className="mt-2 space-y-0.5 text-muted-foreground">
                {conflicts.slice(0, 8).map((c, i) => (
                  <li key={`${c.existingId}-${i}`}>
                    {humanDate(c.date)} —{" "}
                    <span className="font-medium text-foreground">{c.existingTitle}</span>
                    {c.who ? ` (${c.who})` : ""}
                    {c.existingTime ? `, ${c.existingTime}` : ""}
                    {c.occupiedUntil ? ` · holds it until ${c.occupiedUntil}` : ""}
                  </li>
                ))}
                {conflicts.length > 8 && <li>…and {conflicts.length - 8} more</li>}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {blocked
                  ? "Pick a time that doesn't overlap — even a small gap is fine (back-to-back is allowed)."
                  : "You can still submit it — clashes here are flagged, not blocked."}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading || blocked}>
              {loading
                ? "Working…"
                : blocked
                  ? "Unavailable"
                  : hasConflicts
                    ? "Book anyway"
                    : willAutoConfirm
                      ? "Confirm booking"
                      : "Submit request"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
