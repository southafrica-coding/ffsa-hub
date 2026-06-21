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
import type { Booking, Venue, Ministry } from "@/services/bookings";

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
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not save changes.");
      setLoading(false);
      return;
    }
    toast.success("Booking updated.");
    router.push(`/bookings/spaces/${booking.id}`);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-5">
          {booking.series_id && (
            <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              This is one date in a weekly series — your edits apply to this date only.
            </p>
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
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(30_6%_46%)]">
              Times &amp; set-up
            </span>
            <span className="h-px flex-1 bg-[hsl(22_8%_14%)]" />
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
      </CardContent>
    </Card>
  );
}
