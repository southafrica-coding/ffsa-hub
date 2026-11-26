"use client";

import { dueBackFrom } from "@/lib/vehicles/return-day";
import { DueBackNote } from "@/components/vehicles/due-back-note";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { CountryPicker } from "@/app/(admin)/bookings/vehicles/country-picker";
import { PURPOSE_OPTIONS, dayCount } from "@/services/vehicles";
import {
  LICENSE_ACCEPT,
  prepareLicenseFile,
} from "@/app/(admin)/bookings/vehicles/driver-license-field";
import { Plus, Trash2, Paperclip, FileText, X } from "lucide-react";

/**
 * The vehicle request form for people with no Hub account.
 *
 * Everything an internal requester gets from their profile has to be typed
 * here, licence and passport photos included — there's no profile to draw on. That's the
 * whole difference between this form and the internal one.
 */

type PublicVehicle = {
  id: string;
  name: string;
  vehicle_type: string;
  color: string;
};

type DriverRow = {
  name: string;
  phone: string;
  email: string;
  has_sa_license: boolean;
  licence: File | null;
  passport: File | null;
};

const EMPTY_DRIVER: DriverRow = {
  name: "",
  phone: "",
  email: "",
  has_sa_license: false,
  licence: null,
  passport: null,
};

export function PublicVehicleRequestForm({
  token,
  vehicles,
}: {
  token: string;
  vehicles: PublicVehicle[];
}) {
  const [form, setForm] = useState({
    booking_name: "",
    point_person: "",
    destination: "",
    purpose: "ministry",
    purpose_note: "",
    requester_name: "",
    requester_email: "",
    requester_phone: "",
    home_country: "ZA",
    num_people: "",
    checkout_date: "",
    return_date: "",
    notes: "",
  });
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([{ ...EMPTY_DRIVER }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  function setDriver(i: number, patch: Partial<DriverRow>) {
    setDrivers((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function stageDoc(i: number, kind: "licence" | "passport", raw: File | undefined) {
    if (!raw) return;
    const prepared = await prepareLicenseFile(raw);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setDriver(i, { [kind]: prepared.file });
    setError(null);
  }

  const days =
    form.checkout_date && form.return_date && form.return_date >= form.checkout_date
      ? dayCount(form.checkout_date, form.return_date)
      : 0;

  function validate(): string | null {
    if (!form.requester_name.trim()) return "Please enter your name.";
    if (!form.requester_email.trim()) return "Please enter your email address.";
    if (!form.booking_name.trim()) return "Please give the booking a name.";
    if (!form.point_person.trim()) return "Please give the point person for this booking.";
    if (!form.destination.trim()) return "Please tell us where you plan to go with the vehicle.";
    if (!form.checkout_date || !form.return_date)
      return "Please choose the collection date and the last day you need it.";
    if (form.return_date < form.checkout_date)
      return "The last day must be on or after the collection date.";
    if (form.purpose === "other" && !form.purpose_note.trim())
      return "Please describe what you need the vehicle for.";
    const named = drivers.filter((d) => d.name.trim());
    if (named.length === 0) return "Please list at least one driver.";
    // Unlike a Hub user, an outsider has no licence on file anywhere — so it
    // has to come with the request or a coordinator can't approve anything.
    if (named.some((d) => !d.licence))
      return "Please attach a photo of each driver's licence.";
    if (named.some((d) => !d.passport))
      return "Please attach a photo of each driver's passport page.";
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setLoading(true);
    setError(null);

    const named = drivers.filter((d) => d.name.trim());
    const body = new FormData();
    body.append("token", token);
    body.append(
      "payload",
      JSON.stringify({
        booking_name: form.booking_name.trim(),
        point_person: form.point_person.trim(),
        destination: form.destination.trim(),
        purpose: form.purpose,
        purpose_note: form.purpose === "other" ? form.purpose_note.trim() : null,
        requester_name: form.requester_name.trim(),
        requester_email: form.requester_email.trim(),
        requester_phone: form.requester_phone.trim() || null,
        home_country: form.home_country || null,
        num_people: form.num_people ? parseInt(form.num_people, 10) : null,
        checkout_date: form.checkout_date,
        return_date: dueBackFrom(form.return_date),
        notes: form.notes.trim() || null,
        vehicle_ids: vehicleIds,
        drivers: named.map((d) => ({
          name: d.name.trim(),
          phone: d.phone.trim() || null,
          email: d.email.trim() || null,
          has_sa_license: d.has_sa_license,
        })),
      })
    );
    // Index-matched to the driver order above.
    named.forEach((d, i) => {
      if (d.licence) body.append(`licence_${i}`, d.licence);
      if (d.passport) body.append(`passport_${i}`, d.passport);
    });

    const res = await fetch("/api/public/vehicle-requests", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Could not submit your request. Please try again.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-base font-medium">Request sent.</p>
        <p className="text-sm opacity-80">
          A coordinator will confirm the vehicle and email you at{" "}
          {form.requester_email.trim()}. Nothing is booked until they do.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="requester_name">Your name *</Label>
          <Input
            id="requester_name"
            value={form.requester_name}
            onChange={(e) => update("requester_name", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="requester_email">Your email *</Label>
          <Input
            id="requester_email"
            type="email"
            value={form.requester_email}
            onChange={(e) => update("requester_email", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="requester_phone">WhatsApp number</Label>
          <Input
            id="requester_phone"
            value={form.requester_phone}
            onChange={(e) => update("requester_phone", e.target.value)}
            placeholder="+27…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="home_country">Your home country</Label>
          <CountryPicker
            id="home_country"
            value={form.home_country}
            onChange={(v) => update("home_country", v)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="point_person">Point person *</Label>
        <Input
          id="point_person"
          value={form.point_person}
          onChange={(e) => update("point_person", e.target.value)}
          placeholder="Who we should contact about this booking"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="destination">Destination *</Label>
        <Input
          id="destination"
          value={form.destination}
          onChange={(e) => update("destination", e.target.value)}
          placeholder="Where you plan to go, e.g. Cape Town airport, then Stellenbosch"
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="booking_name">Booking name *</Label>
          <Input
            id="booking_name"
            value={form.booking_name}
            onChange={(e) => update("booking_name", e.target.value)}
            placeholder="e.g. Cape Town Youth Team"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="purpose">What for? *</Label>
          <select
            id="purpose"
            value={form.purpose}
            onChange={(e) => update("purpose", e.target.value)}
            className="h-10 w-full border px-3 text-sm"
          >
            {PURPOSE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.purpose === "other" && (
        <div className="space-y-2">
          <Label htmlFor="purpose_note">Tell us more *</Label>
          <Input
            id="purpose_note"
            value={form.purpose_note}
            onChange={(e) => update("purpose_note", e.target.value)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Collection date *</Label>
          <DateInput
            value={form.checkout_date}
            onChange={(v) => update("checkout_date", v)}
          />
        </div>
        <div className="space-y-2">
          <Label>Last day you need it *</Label>
          <DateInput value={form.return_date} onChange={(v) => update("return_date", v)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="num_people">Number of people</Label>
          <Input
            id="num_people"
            type="number"
            min={1}
            value={form.num_people}
            onChange={(e) => update("num_people", e.target.value)}
          />
        </div>
      </div>
      <DueBackNote lastDay={form.return_date} purpose={form.purpose} plain className="sm:max-w-[66%]" />
      {days > 0 && (
        <p className="text-xs opacity-70">
          {days} day{days === 1 ? "" : "s"} (collection to last day, inclusive).
        </p>
      )}

      <div className="space-y-2 border p-4">
        <Label>Vehicle(s) you&apos;d like</Label>
        <p className="text-xs opacity-70">
          Tell us what would suit — the coordinator confirms what&apos;s actually
          free for your dates.
        </p>
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          {vehicles.map((v) => (
            <label
              key={v.id}
              className="flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={vehicleIds.includes(v.id)}
                onChange={() =>
                  setVehicleIds((prev) =>
                    prev.includes(v.id)
                      ? prev.filter((x) => x !== v.id)
                      : [...prev, v.id]
                  )
                }
              />
              <span
                className="inline-block h-2.5 w-2.5 shrink-0"
                style={{ backgroundColor: v.color }}
              />
              <span>{v.name}</span>
              <span className="text-xs capitalize opacity-60">{v.vehicle_type}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3 border p-4">
        <div className="flex items-center justify-between">
          <Label>Drivers</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1"
            onClick={() => setDrivers((p) => [...p, { ...EMPTY_DRIVER }])}
          >
            <Plus className="h-4 w-4" />
            Add driver
          </Button>
        </div>
        <p className="text-xs opacity-70">
          Everyone who&apos;ll drive, with a photo of their licence and of
          their passport photo page. First-time
          drivers of an FFSA vehicle take a short driving test before the
          booking is approved.
        </p>
        {drivers.map((d, i) => (
          <div key={i} className="space-y-2 border-b pb-3 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={d.name}
                onChange={(e) => setDriver(i, { name: e.target.value })}
                placeholder="Name & surname"
                className="h-9 w-48"
              />
              <Input
                value={d.phone}
                onChange={(e) => setDriver(i, { phone: e.target.value })}
                placeholder="WhatsApp number"
                className="h-9 w-40"
              />
              <Input
                type="email"
                value={d.email}
                onChange={(e) => setDriver(i, { email: e.target.value })}
                placeholder="Email (for their instructions)"
                aria-label="Driver email"
                className="h-9 w-56"
              />
              <label className="flex items-center gap-1.5 text-xs opacity-80">
                <input
                  type="checkbox"
                  checked={d.has_sa_license}
                  onChange={(e) => setDriver(i, { has_sa_license: e.target.checked })}
                />
                SA licence
              </label>
              {drivers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDrivers((p) => p.filter((_, idx) => idx !== i))}
                  className="ml-auto opacity-60 hover:opacity-100"
                  aria-label="Remove driver"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {(["licence", "passport"] as const).map((kind) => {
                const file = d[kind];
                const label = kind === "licence" ? "licence photo" : "passport page photo";
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <input
                      id={`${kind}-${i}`}
                      type="file"
                      accept={LICENSE_ACCEPT}
                      className="hidden"
                      onChange={(e) => stageDoc(i, kind, e.target.files?.[0])}
                    />
                    {file ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <FileText className="h-3.5 w-3.5" />
                          {file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDriver(i, { [kind]: null })}
                          className="opacity-60 hover:opacity-100"
                          aria-label={`Remove ${label}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <label
                        htmlFor={`${kind}-${i}`}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-xs underline underline-offset-2"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        Attach {label} *
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Anything else?</Label>
        <textarea
          id="notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={2}
          className="w-full border p-2 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}
