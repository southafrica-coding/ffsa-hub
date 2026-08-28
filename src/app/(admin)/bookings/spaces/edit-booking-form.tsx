"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Booking, Venue, Ministry } from "@/services/bookings";
import { SectionBar } from "@/components/ffsa";

function timeVal(t: string | null): string {
  if (!t) return "";
  const m = t.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

export function EditBookingForm({
  booking,
  venues,
  ministries,
}: {
  booking: Booking;
  venues: Venue[];
  ministries: Ministry[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For a weekly series, default to editing every date — that's almost always
  // what people mean when they change a meeting's name, venue or time.
  const [applyToSeries, setApplyToSeries] = useState(true);

  const [form, setForm] = useState({
    venue_id: booking.venue_id,
    ministry_id: booking.ministry_id ?? "none",
    title: booking.title,
    description: booking.description ?? "",
    point_person: booking.point_person ?? "",
    booking_date: booking.booking_date,
    end_date: booking.end_date ?? "",
    start_time: timeVal(booking.start_time),
    end_time: timeVal(booking.end_time),
    setup_time: timeVal(booking.setup_time),
    setdown_time: timeVal(booking.setdown_time),
  });

  function update(field: keyof typeof form, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    if (error) setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.venue_id) {
      setError("Please choose a venue.");
      return;
    }
    if (!form.title.trim()) {
      setError("Please enter an event name.");
      return;
    }
    if (!form.booking_date) {
      setError("Please choose a date.");
      return;
    }
    if (form.end_date && form.end_date < form.booking_date) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/bookings/${booking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: form.venue_id,
        ministry_id: form.ministry_id === "none" ? null : form.ministry_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        point_person: form.point_person.trim() || null,
        booking_date: form.booking_date,
        end_date: form.end_date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        setup_time: form.setup_time || null,
        setdown_time: form.setdown_time || null,
        applyToSeries: booking.series_id ? applyToSeries : false,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not save changes.");
      setLoading(false);
      return;
    }
    if (json.reopened) {
      toast.success(
        json.appliedToSeries
          ? "Series updated — sent back for approval."
          : "Booking updated — sent back for approval.",
        {
          description:
            "This space needs approval, so the new date, time or venue has to be confirmed by its manager.",
        }
      );
    } else {
      toast.success(
        json.appliedToSeries ? "All dates in this series updated." : "Booking updated."
      );
    }
    router.push(`/bookings/spaces/${booking.id}`);
    router.refresh();
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Booking details" />
      <div className="p-6">
        <form onSubmit={submit} className="space-y-5">
          {booking.series_id && (
            <div className="space-y-2 border border-rule bg-bone px-3 py-2.5">
              <p className="text-xs font-medium text-[color:var(--text-primary)]">
                This is one date in a weekly series. Apply your changes to:
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 text-xs text-[color:var(--text-secondary)]">
                  <input
                    type="radio"
                    name="edit-scope"
                    className="mt-0.5"
                    checked={applyToSeries}
                    onChange={() => setApplyToSeries(true)}
                  />
                  <span>
                    <span className="text-[color:var(--text-primary)]">
                      All dates in this series
                    </span>{" "}
                    — name, description, venue, ministry, point person and times update on
                    every occurrence.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs text-[color:var(--text-secondary)]">
                  <input
                    type="radio"
                    name="edit-scope"
                    className="mt-0.5"
                    checked={!applyToSeries}
                    onChange={() => setApplyToSeries(false)}
                  />
                  <span>
                    <span className="text-[color:var(--text-primary)]">This date only</span> —
                    leave the rest of the series as it is.
                  </span>
                </label>
              </div>
              {applyToSeries && (
                <p className="text-[11px] text-[color:var(--text-secondary)]">
                  The date fields below always apply to this occurrence only — each date in a
                  series is its own day.
                </p>
              )}
            </div>
          )}

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
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Date *</Label>
              <DateInput value={form.booking_date} onChange={(v) => update("booking_date", v)} />
            </div>
            <div className="space-y-2">
              <Label>End date (multi-day)</Label>
              <DateInput value={form.end_date} onChange={(v) => update("end_date", v)} />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="mono-label">
              Times &amp; set-up
            </span>
            <span className="h-px flex-1 bg-rule" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Event start</Label>
              <Input id="start_time" type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">Event end</Label>
              <Input id="end_time" type="time" value={form.end_time} onChange={(e) => update("end_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup_time">Set-up</Label>
              <Input id="setup_time" type="time" value={form.setup_time} onChange={(e) => update("setup_time", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setdown_time">Set-down</Label>
              <Input id="setdown_time" type="time" value={form.setdown_time} onChange={(e) => update("setdown_time", e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/bookings/spaces/${booking.id}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
