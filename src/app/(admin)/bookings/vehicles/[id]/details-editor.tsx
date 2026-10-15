"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
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
import { PURPOSE_OPTIONS } from "@/services/vehicles";

export type EditableDetails = {
  booking_name: string;
  point_person: string;
  purpose: string;
  purpose_note: string;
  requester_phone: string;
  num_people: string;
  checkout_date: string;
  return_date: string;
  notes: string;
};

/**
 * Edit a booking's request details. Only offered while the booking is
 * pending — an approved booking is moved back to pending first (the API
 * enforces the same rule). When a manager saves, the requester is told what
 * changed straight away (Slack DM + email).
 */
export function DetailsEditor({
  bookingId,
  initial,
  notifiesRequester,
}: {
  bookingId: string;
  initial: EditableDetails;
  notifiesRequester: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<EditableDetails>(initial);

  const set = (k: keyof EditableDetails, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.booking_name.trim()) return toast.error("Give the booking a name.");
    if (!form.checkout_date || !form.return_date) return toast.error("Both dates are needed.");
    if (form.return_date < form.checkout_date)
      return toast.error("The return date must be on or after the collection date.");

    // Send only what changed so the requester's "what changed" list is exact.
    const diff: Record<string, unknown> = {};
    (Object.keys(form) as (keyof EditableDetails)[]).forEach((k) => {
      if (form[k] !== initial[k]) diff[k] = k === "num_people" ? (form[k] ? Number(form[k]) : 0) : form[k];
    });
    if (Object.keys(diff).length === 0) {
      setOpen(false);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/vehicles/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(diff),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save.");
        return;
      }
      toast.success(notifiesRequester ? "Saved — the requester has been told what changed." : "Saved.");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit details
      </Button>
    );
  }

  return (
    <div className="space-y-4 border border-rule bg-bone p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ed-name">Booking name</Label>
          <Input id="ed-name" value={form.booking_name} onChange={(e) => set("booking_name", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Collection date</Label>
          <DateInput value={form.checkout_date} onChange={(v) => set("checkout_date", v)} />
        </div>
        <div className="space-y-1">
          <Label>Return date</Label>
          <DateInput value={form.return_date} onChange={(v) => set("return_date", v)} />
        </div>
        <div className="space-y-1">
          <Label>Purpose</Label>
          <Select value={form.purpose} onValueChange={(v) => set("purpose", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Purpose" />
            </SelectTrigger>
            <SelectContent>
              {PURPOSE_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ed-people">People</Label>
          <Input
            id="ed-people"
            type="number"
            min={1}
            value={form.num_people}
            onChange={(e) => set("num_people", e.target.value)}
          />
        </div>
        {form.purpose === "other" && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ed-purpose-note">Purpose detail</Label>
            <Input id="ed-purpose-note" value={form.purpose_note} onChange={(e) => set("purpose_note", e.target.value)} />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ed-point">Point person</Label>
          <Input id="ed-point" value={form.point_person} onChange={(e) => set("point_person", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ed-phone">WhatsApp</Label>
          <Input id="ed-phone" value={form.requester_phone} onChange={(e) => set("requester_phone", e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ed-notes">Notes</Label>
          <textarea
            id="ed-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            className="flex w-full"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setForm(initial);
            setOpen(false);
          }}
        >
          Discard
        </Button>
        {notifiesRequester && (
          <span className="text-xs text-[color:var(--text-secondary)]">
            The requester gets a Slack DM + email listing what changed.
          </span>
        )}
      </div>
    </div>
  );
}
