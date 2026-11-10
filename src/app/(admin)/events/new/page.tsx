"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { DescriptionEditor } from "@/components/events/description-editor";
import { Masthead } from "@/components/ffsa";

export default function NewEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    max_capacity: "",
    is_public: false,
    registration_required: true,
  });

  function updateField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        description: form.description.trim() || null,
        location: form.location.trim() || null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        max_capacity: form.max_capacity ? parseInt(form.max_capacity, 10) : null,
        is_public: form.is_public,
        registration_required: form.registration_required,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; event?: { id: string } };
    if (!res.ok) {
      setError(data.error ?? "Couldn't create the event");
      setLoading(false);
      return;
    }

    router.push(data.event?.id ? `/events/${data.event.id}` : "/events");
    router.refresh();
  }

  return (
    <div className="ffsa-screen">
      <Masthead context="Operations · New event" title="Create Event" />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="max-w-2xl border border-ink p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <DescriptionEditor
                value={form.description}
                onChange={(html) => updateField("description", html)}
                placeholder="Describe the event — add a schedule, headings, lists…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date *</Label>
                <DateInput
                  id="start_date"
                  value={form.start_date}
                  onChange={(v) => updateField("start_date", v)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date">End Date</Label>
                <DateInput
                  id="end_date"
                  value={form.end_date}
                  onChange={(v) => updateField("end_date", v)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={form.start_time}
                  onChange={(e) => updateField("start_time", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End Time</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={form.end_time}
                  onChange={(e) => updateField("end_time", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_capacity">Max Capacity</Label>
              <Input
                id="max_capacity"
                type="number"
                value={form.max_capacity}
                onChange={(e) => updateField("max_capacity", e.target.value)}
                placeholder="Leave blank for unlimited"
              />
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_public}
                  onChange={(e) => updateField("is_public", e.target.checked)}
                  className="border-input"
                />
                Public event
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.registration_required}
                  onChange={(e) =>
                    updateField("registration_required", e.target.checked)
                  }
                  className="border-input"
                />
                Registration required
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Event"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
