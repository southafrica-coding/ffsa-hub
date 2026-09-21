"use client";

import { useEffect, useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { PURPOSE_OPTIONS, dayCount, type Vehicle } from "@/services/vehicles";
import { CountryPicker } from "./country-picker";
import { DriverLicenseField, uploadDriverLicense } from "./driver-license-field";
import { SectionBar } from "@/components/ffsa";
import { PersonSelect, usePeople, toIso2 } from "./people-picker";
import { checkDriverEligibility, licenceStatusLabel } from "@/lib/vehicles/licence";

type DriverRow = {
  /** The Hub user this driver is, or "" for someone outside the Hub. */
  user_id: string;
  name: string;
  phone: string;
  has_sa_license: boolean;
  is_first_time: boolean;
  /** Staged licence file — uploaded after the booking POST returns driver ids.
   *  Only used for outsiders: a Hub user's licence already lives on their
   *  profile and is never re-uploaded here. */
  license: File | null;
};

const EMPTY_DRIVER: DriverRow = {
  user_id: "",
  name: "",
  phone: "",
  has_sa_license: false,
  is_first_time: false,
  license: null,
};

export function VehicleBookingForm({
  vehicles,
  defaultRequesterName,
  defaultRequesterEmail,
  defaultCheckoutDate = "",
}: {
  vehicles: Vehicle[];
  defaultRequesterName: string;
  defaultRequesterEmail: string;
  /** Pre-filled when arriving from a day on the availability calendar. */
  defaultCheckoutDate?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    booking_name: "",
    point_person: "",
    purpose: "ministry",
    purpose_note: "",
    requester_name: defaultRequesterName,
    requester_email: defaultRequesterEmail,
    requester_phone: "",
    home_country: "ZA",
    num_people: "",
    checkout_date: defaultCheckoutDate,
    return_date: defaultCheckoutDate,
    notes: "",
  });
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([{ ...EMPTY_DRIVER }]);
  const { people } = usePeople();
  const [renterId, setRenterId] = useState("");

  const peopleById = new Map(people.map((p) => [p.id, p]));

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  /**
   * Fill the requester block from a profile in one action.
   *
   * The fields stay editable afterwards — a profile seeds the form, it does
   * not lock it. Someone whose WhatsApp differs from their profile number
   * can still correct it for this trip without editing their profile.
   */
  function pickRenter(userId: string) {
    setRenterId(userId);
    if (error) setError(null);
    const person = peopleById.get(userId);
    if (!person) return;
    setForm((prev) => ({
      ...prev,
      requester_name: person.name,
      requester_email: person.email ?? "",
      requester_phone: person.phone ?? prev.requester_phone,
      home_country: toIso2(person.country) || prev.home_country,
    }));
  }

  /**
   * Attach a Hub user to a driver row, or clear it back to a free-text
   * outsider. Their licence stays on their profile — the row only records
   * WHO is driving, and the API re-reads the licence itself at submit.
   */
  function pickDriver(i: number, userId: string) {
    if (error) setError(null);
    const person = peopleById.get(userId);
    if (!person) {
      setDriver(i, { user_id: "", name: "", phone: "" });
      return;
    }
    setDriver(i, {
      user_id: userId,
      name: person.name,
      phone: person.phone ?? "",
      // A licence already on file is the answer to both of these, so the
      // requester never has to self-declare them for a known person.
      has_sa_license: toIso2(person.country) === "ZA",
      is_first_time: person.base_driving_test_status === "pending",
      license: null,
    });
  }

  const datesValid =
    !!form.checkout_date &&
    !!form.return_date &&
    form.return_date >= form.checkout_date;
  const days = datesValid ? dayCount(form.checkout_date, form.return_date) : 0;

  // Live availability for the chosen window.
  useEffect(() => {
    if (!datesValid) {
      setUnavailableIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vehicles/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dryRun: true,
            booking_name: form.booking_name || "x",
            checkout_date: form.checkout_date,
            return_date: form.return_date,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setUnavailableIds(json.unavailableVehicleIds ?? []);
      } catch {
        /* best-effort availability */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.checkout_date, form.return_date]);

  function toggleVehicle(id: string) {
    setVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
    if (error) setError(null);
  }

  function setDriver(i: number, patch: Partial<DriverRow>) {
    setDrivers((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function validate(): string | null {
    if (!form.booking_name.trim()) return "Please enter a booking name (team or person).";
    if (!form.checkout_date || !form.return_date) return "Please choose collection and return dates.";
    if (form.return_date < form.checkout_date) return "The return date must be on or after the collection date.";
    if (form.purpose === "other" && !form.purpose_note.trim())
      return "Please describe the purpose.";
    const clashing = vehicleIds.filter((id) => unavailableIds.includes(id));
    if (clashing.length > 0) return "One or more chosen vehicles is unavailable for those dates.";
    // Hard block: a Hub driver must hold a licence that is valid for the whole
    // trip. The API repeats this check against the database — this copy only
    // exists so the requester finds out before submitting, not after.
    for (const d of drivers) {
      if (!d.user_id) continue;
      const person = peopleById.get(d.user_id);
      if (!person) continue;
      const check = checkDriverEligibility(person, form.return_date || null, "request");
      if (!check.ok) return `${person.name} cannot be added as a driver — ${check.message}`;
    }
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

    const cleanDrivers = drivers
      .map((d) => ({ ...d, name: d.name.trim(), phone: d.phone.trim() }))
      .filter((d) => d.name);

    const res = await fetch("/api/vehicles/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_name: form.booking_name.trim(),
        point_person: form.point_person.trim() || null,
        purpose: form.purpose,
        purpose_note: form.purpose === "other" ? form.purpose_note.trim() : null,
        requester_name: form.requester_name.trim() || null,
        requester_email: form.requester_email.trim() || null,
        requester_phone: form.requester_phone.trim() || null,
        num_people: form.num_people ? parseInt(form.num_people, 10) : null,
        checkout_date: form.checkout_date,
        return_date: form.return_date,
        home_country: form.home_country || null,
        notes: form.notes.trim() || null,
        vehicle_ids: vehicleIds,
        // The staged licence File isn't part of the JSON payload — it uploads
        // separately once the driver rows exist.
        drivers: cleanDrivers.map((d) => ({
          user_id: d.user_id || null,
          name: d.name,
          phone: d.phone,
          has_sa_license: d.has_sa_license,
          is_first_time: d.is_first_time,
        })),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Could not submit the request.");
      setLoading(false);
      return;
    }
    // Licences can only be attached once the driver rows exist, so upload them
    // in a second pass. A failure here must not lose the booking — the driver
    // list on the booking page can always take the licence later.
    // The API returns the created drivers in the order they were submitted, so
    // index i here is the same driver as cleanDrivers[i].
    const createdDrivers: { id: string; name: string }[] = json.drivers ?? [];
    const withLicense = cleanDrivers
      .map((d, i) => ({ driver: d, created: createdDrivers[i] ?? null }))
      .filter((x) => x.driver.license);
    if (withLicense.length > 0) {
      const failed: string[] = [];
      await Promise.all(
        withLicense.map(async ({ driver, created }) => {
          if (!created) {
            failed.push(driver.name);
            return;
          }
          const result = await uploadDriverLicense(created.id, driver.license as File);
          if ("error" in result) failed.push(driver.name);
        })
      );
      if (failed.length > 0) {
        toast.warning(
          `Request submitted, but the licence for ${failed.join(", ")} did not upload. Add it from the booking page.`
        );
      }
    }

    toast.success("Vehicle request submitted for approval.");
    router.push(json.bookingId ? `/bookings/vehicles/${json.bookingId}` : "/bookings/vehicles");
    router.refresh();
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Request details" />
      <div className="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          {/* Who / what */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="booking_name">Booking name *</Label>
              <Input
                id="booking_name"
                value={form.booking_name}
                onChange={(e) => update("booking_name", e.target.value)}
                placeholder="e.g. FF Kona | Youth Team"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Select value={form.purpose} onValueChange={(v) => update("purpose", v)}>
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
          </div>

          {form.purpose === "other" && (
            <div className="space-y-2">
              <Label htmlFor="purpose_note">Describe the purpose *</Label>
              <Input
                id="purpose_note"
                value={form.purpose_note}
                onChange={(e) => update("purpose_note", e.target.value)}
              />
            </div>
          )}

          {/* Who this is for — fills the three fields below from a profile. */}
          <div className="space-y-2 max-w-md">
            <Label htmlFor="renter">Booking for</Label>
            <PersonSelect
              id="renter"
              value={renterId}
              onChange={pickRenter}
              people={people}
              outsiderLabel="Someone not in the Hub — type their details"
              className="h-10 w-full border border-rule-strong bg-white px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Pick a person and their contact details fill in below. Everything
              stays editable.
            </p>
          </div>

          {/* Requester */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="requester_name">Requested by</Label>
              <Input
                id="requester_name"
                value={form.requester_name}
                onChange={(e) => update("requester_name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requester_email">Email</Label>
              <Input
                id="requester_email"
                type="email"
                value={form.requester_email}
                onChange={(e) => update("requester_email", e.target.value)}
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
          </div>

          {/* Home country (drives the Xero org) */}
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="home_country">Renter&apos;s home country</Label>
            <CountryPicker
              id="home_country"
              value={form.home_country}
              onChange={(v) => update("home_country", v)}
            />
            <p className="text-xs text-muted-foreground">
              US renters are billed in FFSA&apos;s US Xero; everyone else in SA Xero.
            </p>
          </div>

          {/* When + people */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Collection date *</Label>
              <DateInput value={form.checkout_date} onChange={(v) => update("checkout_date", v)} />
            </div>
            <div className="space-y-2">
              <Label>Return date *</Label>
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
          {days > 0 && (
            <p className="text-xs text-muted-foreground">
              {days} day{days === 1 ? "" : "s"} (collection → return, inclusive).
            </p>
          )}

          {/* Vehicles */}
          <div className="space-y-2 border border-rule bg-bone p-4">
            <Label>Vehicle(s) requested</Label>
            <p className="text-xs text-muted-foreground">
              Pick the vehicles you&apos;d like — the coordinator confirms the final
              assignment. Unavailable vehicles are already booked for your dates.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {vehicles.map((v) => {
                const unavailable = unavailableIds.includes(v.id);
                const checked = vehicleIds.includes(v.id);
                return (
                  <label
                    key={v.id}
                    className={
                      "flex items-center gap-2 border px-3 py-2 text-sm " +
                      (unavailable ? "border-rule opacity-50" : "cursor-pointer border-rule-strong hover:bg-bone")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={unavailable}
                      onChange={() => toggleVehicle(v.id)}
                      className="rounded border-input"
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0"
                      style={{ backgroundColor: v.color }}
                    />
                    <span className="text-foreground">{v.name}</span>
                    <span className="text-xs capitalize text-muted-foreground">{v.vehicle_type}</span>
                    {unavailable && (
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-destructive">
                        Booked
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Drivers */}
          <div className="space-y-3 border border-rule bg-bone p-4">
            <div className="flex items-center justify-between">
              <Label>Drivers</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={() => setDrivers((p) => [...p, { ...EMPTY_DRIVER }])}
              >
                <Plus className="h-4 w-4" />
                Add driver
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick each driver from the Hub and their licence comes with them.
              A driver whose licence is missing or expires before the return
              date can&apos;t be added — they need to update it on their profile
              first. Drivers from outside the Hub are typed in by hand.
            </p>
            {drivers.map((d, i) => {
              const person = d.user_id ? peopleById.get(d.user_id) : undefined;
              const status = person
                ? licenceStatusLabel(person, form.return_date || null)
                : null;
              return (
              <div key={i} className="space-y-1.5 border-b border-rule pb-3 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <PersonSelect
                  value={d.user_id}
                  onChange={(id) => pickDriver(i, id)}
                  people={people}
                  outsiderLabel="Not in the Hub…"
                  className="h-9 w-56 border border-rule-strong bg-white px-2 text-sm"
                />
                {/* Outsiders keep the old free-text row: no profile to draw on. */}
                {!d.user_id && (
                  <>
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
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={d.has_sa_license}
                        onChange={(e) => setDriver(i, { has_sa_license: e.target.checked })}
                        className="rounded border-input"
                      />
                      SA licence
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={d.is_first_time}
                        onChange={(e) => setDriver(i, { is_first_time: e.target.checked })}
                        className="rounded border-input"
                      />
                      First time / international
                    </label>
                  </>
                )}
                {person && d.phone && (
                  <span className="text-xs text-muted-foreground">{d.phone}</span>
                )}
                {/* A Hub user who has never driven a base vehicle still has to
                    be flagged: their profile defaults to "not required", so
                    without this nobody would ever be sent for a driving test. */}
                {person && person.base_driving_test_status === "not_required" && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={d.is_first_time}
                      onChange={(e) => setDriver(i, { is_first_time: e.target.checked })}
                      className="rounded border-input"
                    />
                    First time driving a base vehicle
                  </label>
                )}
                {drivers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDrivers((p) => p.filter((_, idx) => idx !== i))}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    aria-label="Remove driver"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {status && (
                <p
                  className={
                    "text-xs " +
                    (status.tone === "ok"
                      ? "text-muted-foreground"
                      : status.tone === "warn"
                        ? "text-foreground"
                        : "text-destructive")
                  }
                >
                  {status.label}
                </p>
              )}

              {/* Only outsiders attach a licence here — a Hub user's licence
                  is already on their profile. */}
              {!d.user_id && (
                <DriverLicenseField
                  staged={d.license}
                  onStage={(file) => setDriver(i, { license: file })}
                />
              )}
              </div>
              );
            })}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={2}
              placeholder="Anything the coordinator should know"
              className="flex w-full"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting…" : "Submit request"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
