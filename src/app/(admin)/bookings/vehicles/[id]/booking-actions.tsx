"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Ban, CheckCheck, Wand2 } from "lucide-react";
import { SectionBar } from "@/components/ffsa";
import type { Vehicle } from "@/services/vehicles";
import { standardDailyUsd, standardQuoteUsd } from "@/lib/vehicles/pricing";
import { CountryPicker } from "../country-picker";

type ActionBooking = {
  id: string;
  status: string;
  checkout_date: string;
  return_date: string;
  pricing_per_day: number | null;
  total_amount: number | null;
  currency: string;
  payment_required: boolean;
  payment_received: boolean;
  home_country: string | null;
};

export function VehicleBookingActions({
  booking,
  vehicles,
  assignedIds,
  unavailableIds,
  days,
  isManager,
  isOwner,
}: {
  booking: ActionBooking;
  vehicles: Vehicle[];
  assignedIds: string[];
  unavailableIds: string[];
  days: number;
  isManager: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [selected, setSelected] = useState<string[]>(assignedIds);
  const [homeCountry, setHomeCountry] = useState(booking.home_country ?? "");
  const [pay, setPay] = useState({
    payment_required: booking.payment_required,
    pricing_per_day: booking.pricing_per_day?.toString() ?? "",
    total_amount: booking.total_amount?.toString() ?? "",
    currency: booking.currency || "USD",
    payment_received: booking.payment_received,
  });

  const isActive = booking.status === "pending" || booking.status === "approved";

  if (!isManager && !isOwner) return null;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  // Standard USD rates (Car $25/day, Van $68/day) from the assigned vehicles.
  const selectedTypes = selected
    .map((id) => vehicles.find((v) => v.id === id)?.vehicle_type)
    .filter((t): t is "van" | "car" => t === "van" || t === "car");

  function applyStandardRate() {
    if (selectedTypes.length === 0) {
      toast.error("Assign at least one vehicle first.");
      return;
    }
    setPay((p) => ({
      ...p,
      payment_required: true,
      currency: "USD",
      pricing_per_day: standardDailyUsd(selectedTypes).toString(),
      total_amount: standardQuoteUsd(selectedTypes, days).toString(),
    }));
  }

  async function saveManage() {
    setBusy("save");
    try {
      const res = await fetch(`/api/vehicles/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_ids: selected,
          home_country: homeCountry || null,
          payment_required: pay.payment_required,
          pricing_per_day: pay.pricing_per_day ? parseFloat(pay.pricing_per_day) : null,
          total_amount: pay.total_amount ? parseFloat(pay.total_amount) : null,
          currency: pay.currency,
          payment_received: pay.payment_received,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save.");
        setBusy(null);
        return;
      }
      toast.success("Booking updated.");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: "approved" | "denied" | "completed") {
    setBusy(decision);
    try {
      const res = await fetch(`/api/vehicles/bookings/${booking.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not update.");
        setBusy(null);
        return;
      }
      toast.success(`Booking ${decision}.`);
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
      setBusy(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this booking?")) return;
    setBusy("cancel");
    try {
      const res = await fetch(`/api/vehicles/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not cancel.");
        setBusy(null);
        return;
      }
      toast.success("Booking cancelled.");
      router.refresh();
    } catch {
      toast.error("Network error — please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Manage booking" />
      <div className="space-y-5 p-6">
        {isManager && (
          <>
            {/* Assign vehicles */}
            <div className="space-y-2">
              <Label>Assign vehicles</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {vehicles.map((v) => {
                  const checked = selected.includes(v.id);
                  const blocked = unavailableIds.includes(v.id) && !checked;
                  return (
                    <label
                      key={v.id}
                      className={
                        "flex items-center gap-2 border px-3 py-2 text-sm " +
                        (blocked ? "border-rule opacity-50" : "cursor-pointer border-rule-strong hover:bg-bone")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => toggle(v.id)}

                      />
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0"
                        style={{ backgroundColor: v.color }}
                      />
                      <span>{v.name}</span>
                      <span className="text-xs capitalize text-[color:var(--text-tertiary)]">
                        {v.vehicle_type}
                      </span>
                      {blocked && (
                        <span className="mono-label ml-auto !text-destructive">
                          Booked
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Home country → Xero org */}
            <div className="space-y-1 max-w-xs">
              <Label className="text-xs">Renter&apos;s home country (Xero org)</Label>
              <CountryPicker
                value={homeCountry}
                onChange={setHomeCountry}
                className="h-9 w-full"
              />
              <p className="text-[11px] text-[color:var(--text-secondary)]">
                {(homeCountry || "").toUpperCase() === "US"
                  ? "Invoices to FFSA US Xero (1040 / Tax-Exempt)."
                  : "Invoices to FFSA SA Xero (1050 / No-VAT)."}
              </p>
            </div>

            {/* Pricing & payment */}
            <div className="space-y-3 border border-rule bg-bone p-4">
              <label className="flex items-center gap-2 !text-sm !normal-case !tracking-normal">
                <input
                  type="checkbox"
                  checked={pay.payment_required}
                  onChange={(e) => setPay({ ...pay, payment_required: e.target.checked })}

                />
                This booking is chargeable (payment required before keys)
              </label>
              {pay.payment_required && (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Currency</Label>
                      <Input
                        value={pay.currency}
                        onChange={(e) => setPay({ ...pay, currency: e.target.value })}
                        className="h-9 w-20"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price / day</Label>
                      <Input
                        type="number"
                        value={pay.pricing_per_day}
                        onChange={(e) => setPay({ ...pay, pricing_per_day: e.target.value })}
                        className="h-9 w-28"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Total ({days} days)</Label>
                      <Input
                        type="number"
                        value={pay.total_amount}
                        onChange={(e) => setPay({ ...pay, total_amount: e.target.value })}
                        className="h-9 w-28"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPay((p) => ({
                          ...p,
                          total_amount: p.pricing_per_day
                            ? (parseFloat(p.pricing_per_day) * days).toString()
                            : p.total_amount,
                        }))
                      }
                    >
                      = price × days
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={applyStandardRate}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Standard ($25 car / $68 van/day)
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 !text-sm !normal-case !tracking-normal">
                    <input
                      type="checkbox"
                      checked={pay.payment_received}
                      onChange={(e) => setPay({ ...pay, payment_received: e.target.checked })}
    
                    />
                    Payment received
                  </label>
                </>
              )}
            </div>

            <Button onClick={saveManage} disabled={!!busy} size="sm">
              {busy === "save" ? "Saving…" : "Save assignment & payment"}
            </Button>

            {/* Decision */}
            {isActive && (
              <div className="space-y-3 border-t border-rule pt-4">
                <div className="space-y-2">
                  <Label htmlFor="decision-note">Decision note (optional)</Label>
                  <textarea
                    id="decision-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Approved — collect keys at the Legal Offices."
                    className="flex w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {booking.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decide("approved")}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 border border-ink bg-ink px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" />
                        {busy === "approved" ? "Approving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide("denied")}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 border border-destructive px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-destructive disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {busy === "denied" ? "Denying…" : "Deny"}
                      </button>
                    </>
                  )}
                  {booking.status === "approved" && (
                    <button
                      type="button"
                      onClick={() => decide("completed")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1.5 border border-ink px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink disabled:opacity-50"
                    >
                      <CheckCheck className="h-4 w-4" />
                      {busy === "completed" ? "Completing…" : "Mark completed"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Cancel — managers or the requester, while still active */}
        {isActive && (isManager || isOwner) && (
          <div>
            <Button
              onClick={cancel}
              disabled={!!busy}
              variant="ghost"
              size="sm"
              className="gap-1"
            >
              <Ban className="h-4 w-4" />
              {busy === "cancel" ? "Cancelling…" : "Cancel booking"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
