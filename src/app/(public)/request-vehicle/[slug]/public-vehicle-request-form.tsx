"use client";

import { useEffect, useState } from "react";
import {
  PublicFormShell,
  PublicFormInputStyles,
  tokensForBrand,
} from "@/components/public-form-shell";
import { PURPOSE_OPTIONS, dayCount, type Vehicle } from "@/services/vehicles";

const T = tokensForBrand("ff");

type DriverRow = {
  name: string;
  phone: string;
  has_sa_license: boolean;
  is_first_time: boolean;
};

const EMPTY_DRIVER: DriverRow = {
  name: "",
  phone: "",
  has_sa_license: false,
  is_first_time: false,
};

export function PublicVehicleRequestForm({
  slug,
  vehicles,
  introNote,
}: {
  slug: string;
  vehicles: Vehicle[];
  introNote: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    requester_name: "",
    requester_email: "",
    requester_phone: "",
    booking_name: "",
    purpose: "ministry",
    purpose_note: "",
    num_people: "",
    checkout_date: "",
    return_date: "",
    notes: "",
    // Honeypot — kept empty by real users; bots fill it.
    company: "",
  });
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([{ ...EMPTY_DRIVER }]);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  const datesValid =
    !!form.checkout_date &&
    !!form.return_date &&
    form.return_date >= form.checkout_date;
  const days = datesValid ? dayCount(form.checkout_date, form.return_date) : 0;

  // Live availability for the chosen window (best-effort).
  useEffect(() => {
    if (!datesValid) {
      setUnavailableIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({
          slug,
          from: form.checkout_date,
          to: form.return_date,
        });
        const res = await fetch(`/api/public/vehicle-requests?${qs.toString()}`);
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
    if (!form.requester_name.trim()) return "Please enter your name.";
    const email = form.requester_email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return "Please enter a valid email address.";
    if (!form.checkout_date || !form.return_date)
      return "Please choose collection and return dates.";
    if (form.return_date < form.checkout_date)
      return "The return date must be on or after the collection date.";
    if (form.purpose === "other" && !form.purpose_note.trim())
      return "Please describe the purpose.";
    const clashing = vehicleIds.filter((id) => unavailableIds.includes(id));
    if (clashing.length > 0)
      return "One or more chosen vehicles is unavailable for those dates.";
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

    try {
      const res = await fetch("/api/public/vehicle-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          company: form.company, // honeypot
          requester_name: form.requester_name.trim(),
          requester_email: form.requester_email.trim(),
          requester_phone: form.requester_phone.trim() || null,
          booking_name: form.booking_name.trim() || null,
          purpose: form.purpose,
          purpose_note: form.purpose === "other" ? form.purpose_note.trim() : null,
          num_people: form.num_people ? parseInt(form.num_people, 10) : null,
          checkout_date: form.checkout_date,
          return_date: form.return_date,
          notes: form.notes.trim() || null,
          vehicle_ids: vehicleIds,
          drivers: cleanDrivers,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not submit your request. Please try again.");
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <PublicFormShell
        eyebrow="Request Received"
        heading="We've got your request"
        maxWidth={520}
      >
        <p style={{ fontSize: 15, color: T.textDim, lineHeight: 1.6, margin: 0 }}>
          Thanks, {form.requester_name.trim() || "there"} — your vehicle request is
          now with the Vehicle Coordinator for review. Submitting a request doesn&apos;t
          guarantee a vehicle. We&apos;ve emailed a confirmation to{" "}
          <span style={{ color: T.text }}>{form.requester_email.trim()}</span> and
          we&apos;ll be in touch once it&apos;s approved or declined.
        </p>
      </PublicFormShell>
    );
  }

  return (
    <div className="ffsa-public">
      <PublicFormInputStyles brand="ff" />
      <PublicFormShell
        eyebrow="Vehicle Requests"
        heading="Request a vehicle"
        subheading="Fire & Fragrance South Africa · base fleet"
        maxWidth={560}
        footerNote="Submitting a request does not guarantee a vehicle — it goes to the Vehicle Coordinator for approval."
      >
        {introNote && (
          <p
            className="mb-6"
            style={{
              fontSize: 14,
              color: T.textDim,
              lineHeight: 1.6,
              background: `${T.yellow}10`,
              border: `1px solid ${T.borderSoft}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            {introNote}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          {/* Honeypot — visually hidden, off-screen, not announced. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
            <label>
              Company
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.company}
                onChange={(e) => update("company", e.target.value)}
              />
            </label>
          </div>

          {/* Who */}
          <div>
            <label className="ffsa-public-label ffsa-public-label-required">Your name</label>
            <input
              type="text"
              value={form.requester_name}
              onChange={(e) => update("requester_name", e.target.value)}
              placeholder="Name & surname"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="ffsa-public-label ffsa-public-label-required">Email</label>
              <input
                type="email"
                value={form.requester_email}
                onChange={(e) => update("requester_email", e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="ffsa-public-label">WhatsApp number</label>
              <input
                type="tel"
                value={form.requester_phone}
                onChange={(e) => update("requester_phone", e.target.value)}
                placeholder="+27…"
              />
            </div>
          </div>

          <div>
            <label className="ffsa-public-label">Group or team name</label>
            <input
              type="text"
              value={form.booking_name}
              onChange={(e) => update("booking_name", e.target.value)}
              placeholder="e.g. Visiting youth team (optional)"
            />
          </div>

          {/* Purpose */}
          <div>
            <label className="ffsa-public-label ffsa-public-label-required">Purpose</label>
            <select value={form.purpose} onChange={(e) => update("purpose", e.target.value)}>
              {PURPOSE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {form.purpose === "other" && (
            <div>
              <label className="ffsa-public-label ffsa-public-label-required">
                Describe the purpose
              </label>
              <input
                type="text"
                value={form.purpose_note}
                onChange={(e) => update("purpose_note", e.target.value)}
              />
            </div>
          )}

          {/* When + people */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="ffsa-public-label ffsa-public-label-required">
                Collection date
              </label>
              <input
                type="date"
                value={form.checkout_date}
                onChange={(e) => update("checkout_date", e.target.value)}
              />
            </div>
            <div>
              <label className="ffsa-public-label ffsa-public-label-required">Return date</label>
              <input
                type="date"
                value={form.return_date}
                min={form.checkout_date || undefined}
                onChange={(e) => update("return_date", e.target.value)}
              />
            </div>
            <div>
              <label className="ffsa-public-label">People</label>
              <input
                type="number"
                min={1}
                value={form.num_people}
                onChange={(e) => update("num_people", e.target.value)}
              />
            </div>
          </div>
          {days > 0 && (
            <p style={{ fontSize: 12, color: T.textDimmer, margin: "-8px 0 0" }}>
              {days} day{days === 1 ? "" : "s"} (collection → return, inclusive).
            </p>
          )}

          {/* Vehicles */}
          {vehicles.length > 0 && (
            <div>
              <label className="ffsa-public-label">Vehicle(s) you&apos;d like</label>
              <p style={{ fontSize: 12, color: T.textDimmer, margin: "0 0 8px" }}>
                The coordinator confirms the final assignment. Vehicles already booked for
                your dates are greyed out.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {vehicles.map((v) => {
                  const unavailable = unavailableIds.includes(v.id);
                  const checked = vehicleIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`ffsa-public-card flex items-center gap-2 text-sm ${
                        checked ? "is-selected" : ""
                      }`}
                      style={{
                        padding: "10px 12px",
                        cursor: unavailable ? "not-allowed" : "pointer",
                        opacity: unavailable ? 0.45 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={unavailable}
                        onChange={() => toggleVehicle(v.id)}
                        style={{ accentColor: T.yellow, flexShrink: 0 }}
                      />
                      <span
                        style={{
                          display: "inline-block",
                          height: 10,
                          width: 10,
                          flexShrink: 0,
                          borderRadius: 999,
                          background: v.color,
                        }}
                      />
                      <span style={{ color: T.text }}>{v.name}</span>
                      <span style={{ color: T.textDimmer, textTransform: "capitalize" }}>
                        {v.vehicle_type}
                      </span>
                      {unavailable && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: T.red,
                          }}
                        >
                          Booked
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drivers */}
          <div>
            <div className="flex items-center justify-between">
              <label className="ffsa-public-label" style={{ marginBottom: 0 }}>
                Drivers
              </label>
              <button
                type="button"
                className="ffsa-public-btn-ghost"
                onClick={() => setDrivers((p) => [...p, { ...EMPTY_DRIVER }])}
              >
                + Add driver
              </button>
            </div>
            <p style={{ fontSize: 12, color: T.textDimmer, margin: "4px 0 8px" }}>
              First-time base-vehicle drivers (and internationals) must pass a driving test
              before approval.
            </p>
            <div className="space-y-3">
              {drivers.map((d, i) => (
                <div
                  key={i}
                  className="ffsa-public-card space-y-2"
                  style={{ padding: "12px 14px" }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => setDriver(i, { name: e.target.value })}
                      placeholder="Name & surname"
                    />
                    <input
                      type="tel"
                      value={d.phone}
                      onChange={(e) => setDriver(i, { phone: e.target.value })}
                      placeholder="WhatsApp number"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label
                      className="flex items-center gap-1.5"
                      style={{ fontSize: 13, color: T.textDim }}
                    >
                      <input
                        type="checkbox"
                        checked={d.has_sa_license}
                        onChange={(e) => setDriver(i, { has_sa_license: e.target.checked })}
                        style={{ accentColor: T.yellow }}
                      />
                      SA licence
                    </label>
                    <label
                      className="flex items-center gap-1.5"
                      style={{ fontSize: 13, color: T.textDim }}
                    >
                      <input
                        type="checkbox"
                        checked={d.is_first_time}
                        onChange={(e) => setDriver(i, { is_first_time: e.target.checked })}
                        style={{ accentColor: T.yellow }}
                      />
                      First time / international
                    </label>
                    {drivers.length > 1 && (
                      <button
                        type="button"
                        className="ffsa-public-btn-ghost"
                        style={{ marginLeft: "auto" }}
                        onClick={() => setDrivers((p) => p.filter((_, idx) => idx !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="ffsa-public-label">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              style={{ resize: "none" }}
              placeholder="Anything the coordinator should know"
            />
          </div>

          {error && <p className="ffsa-public-error">{error}</p>}

          <div className="pt-1">
            <button type="submit" className="ffsa-public-btn-primary" disabled={loading}>
              {loading ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>
      </PublicFormShell>
    </div>
  );
}
