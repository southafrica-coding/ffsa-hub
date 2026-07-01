"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Lock, Pencil } from "lucide-react";

type EventBrand = "ff" | "the_send" | "ffsa_camps" | "preachers";

const BRAND_OPTIONS: Array<{ value: EventBrand; label: string; helper: string }> = [
  {
    value: "ff",
    label: "Fire & Fragrance",
    helper: "Standard F&F email template — black/gold workflow shell.",
  },
  {
    value: "the_send",
    label: "THE SEND",
    helper:
      "Bespoke navy/cream/gold template for every email tied to this event — workflow steps, ticket confirmations, and follow-ups.",
  },
  {
    value: "ffsa_camps",
    label: "FFSA Camps",
    helper:
      "Bespoke blue/cream FFSA Camps template — storefront, workflow steps, ticket confirmations, and follow-ups all read as one Camps identity.",
  },
  {
    value: "preachers",
    label: "PREACHERS SA",
    helper:
      "Bespoke DARK navy/bone rock-poster template — storefront, workflow steps, ticket confirmations, and follow-ups all read as one PREACHERS identity. Slogan: “GO. PREACH.”",
  },
];

function normalizeBrand(raw: string | null | undefined): EventBrand {
  if (raw === "the_send") return "the_send";
  if (raw === "ffsa_camps") return "ffsa_camps";
  if (raw === "preachers") return "preachers";
  return "ff";
}

type EventCore = {
  title: string;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  max_capacity: number | null;
  is_public: boolean;
  registration_required: boolean;
  brand?: string | null;
};

type FormState = {
  title: string;
  description: string;
  location: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  max_capacity: string;
  is_public: boolean;
  registration_required: boolean;
  brand: EventBrand;
};

function toFormState(e: EventCore): FormState {
  return {
    title: e.title ?? "",
    description: e.description ?? "",
    location: e.location ?? "",
    start_date: e.start_date ?? "",
    end_date: e.end_date ?? "",
    start_time: e.start_time ? e.start_time.slice(0, 5) : "",
    end_time: e.end_time ? e.end_time.slice(0, 5) : "",
    max_capacity: e.max_capacity != null ? String(e.max_capacity) : "",
    is_public: !!e.is_public,
    registration_required: !!e.registration_required,
    brand: normalizeBrand(e.brand ?? null),
  };
}

export function EventDetailsForm({
  eventId,
  status,
  event,
}: {
  eventId: string;
  status: string;
  event: EventCore;
}) {
  const router = useRouter();
  const initial = useMemo(() => toFormState(event), [event]);
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editable = status === "draft";

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  async function save() {
    if (!form.title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (!form.start_date) {
      setErr("Start date is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
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
        brand: form.brand,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't save changes. Please try again.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  function reset() {
    setForm(initial);
    setErr(null);
    setSaved(false);
  }

  // ── Locked (published / cancelled / completed) ──────────────
  if (!editable) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Event details</CardTitle>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Locked while live
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReadRow label="Title" value={event.title} />
          <ReadRow label="Description" value={event.description} pre />
          <ReadRow label="Location" value={event.location} />
          <div className="grid grid-cols-2 gap-3">
            <ReadRow label="Start date" value={event.start_date} />
            <ReadRow label="End date" value={event.end_date} />
            <ReadRow label="Start time" value={event.start_time} />
            <ReadRow label="End time" value={event.end_time} />
          </div>
          <ReadRow
            label="Capacity"
            value={event.max_capacity != null ? String(event.max_capacity) : "Unlimited"}
          />
          <ReadRow
            label="Email brand"
            value={
              BRAND_OPTIONS.find((o) => o.value === normalizeBrand(event.brand))?.label
                ?? null
            }
          />
          <p className="text-xs text-muted-foreground border-t pt-3">
            To edit any of these, use <strong>Revert to draft</strong> at the top
            of the page. Editing reopens here, then hit Publish to go live again.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Editable (draft) ────────────────────────────────────────
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Event details</CardTitle>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-500">
          <Pencil className="h-3 w-3" /> Editable — event is in draft
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ev-title">Title *</Label>
          <Input
            id="ev-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-desc">Description</Label>
          <textarea
            id="ev-desc"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-location">Location</Label>
          <Input
            id="ev-location"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="ev-start-date">Start date *</Label>
            <DateInput
              id="ev-start-date"
              value={form.start_date}
              onChange={(v) => set("start_date", v)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ev-end-date">End date</Label>
            <DateInput
              id="ev-end-date"
              value={form.end_date}
              onChange={(v) => set("end_date", v)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ev-start-time">Start time</Label>
            <Input
              id="ev-start-time"
              type="time"
              value={form.start_time}
              onChange={(e) => set("start_time", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ev-end-time">End time</Label>
            <Input
              id="ev-end-time"
              type="time"
              value={form.end_time}
              onChange={(e) => set("end_time", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ev-capacity">Max capacity</Label>
          <Input
            id="ev-capacity"
            type="number"
            min="0"
            placeholder="Leave blank for unlimited"
            value={form.max_capacity}
            onChange={(e) => set("max_capacity", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => set("is_public", e.target.checked)}
            />
            Public event
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.registration_required}
              onChange={(e) => set("registration_required", e.target.checked)}
            />
            Registration required
          </label>
        </div>

        {/* Email brand — drives the template for every email tied
            to this event (workflow steps, ticket confirmations, etc). */}
        <div className="space-y-2 pt-1 border-t pt-4">
          <Label htmlFor="ev-brand">Email brand</Label>
          <select
            id="ev-brand"
            value={form.brand}
            onChange={(e) => set("brand", e.target.value as EventBrand)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {BRAND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {BRAND_OPTIONS.find((o) => o.value === form.brand)?.helper}
          </p>
        </div>

        {err && <p className="text-xs text-red-600">{err}</p>}
        {saved && !dirty && (
          <p className="text-xs text-green-600">Saved.</p>
        )}

        {dirty && (
          <div className="flex items-center gap-2 border-t pt-3">
            <Button onClick={save} disabled={busy} size="sm">
              {busy ? "Saving…" : "Save changes"}
            </Button>
            <Button
              onClick={reset}
              disabled={busy}
              size="sm"
              variant="outline"
            >
              Discard
            </Button>
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReadRow({
  label,
  value,
  pre,
}: {
  label: string;
  value: string | null;
  pre?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={`text-sm ${pre ? "whitespace-pre-wrap" : ""}`}>
        {value || <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
}
