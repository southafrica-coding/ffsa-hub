"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X, Ban, CheckCheck } from "lucide-react";
import type { Vehicle } from "@/services/vehicles";

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

  async function saveManage() {
    setBusy("save");
    try {
      const res = await fetch(`/api/vehicles/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_ids: selected,
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
    <Card>
      <CardContent className="space-y-5 pt-6">
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
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm " +
                        (blocked ? "opacity-50" : "cursor-pointer hover:bg-white/5")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => toggle(v.id)}
                        className="rounded border-input"
                      />
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: v.color }}
                      />
                      <span className="text-foreground">{v.name}</span>
                      <span className="text-xs capitalize text-muted-foreground">
                        {v.vehicle_type}
                      </span>
                      {blocked && (
                        <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-[hsl(0_70%_66%)]">
                          Booked
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Pricing & payment */}
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pay.payment_required}
                  onChange={(e) => setPay({ ...pay, payment_required: e.target.checked })}
                  className="rounded border-input"
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
                      className="text-muted-foreground"
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
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pay.payment_received}
                      onChange={(e) => setPay({ ...pay, payment_received: e.target.checked })}
                      className="rounded border-input"
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
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="decision-note">Decision note (optional)</Label>
                  <textarea
                    id="decision-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Approved — collect keys at the Legal Offices."
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {booking.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decide("approved")}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-50"
                        style={{ background: "hsl(142 48% 32%)", color: "hsl(142 60% 90%)" }}
                      >
                        <Check className="h-4 w-4" />
                        {busy === "approved" ? "Approving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide("denied")}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-[11px] tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-50"
                        style={{
                          background: "hsl(0 65% 30% / 0.30)",
                          color: "hsl(0 75% 78%)",
                          borderColor: "hsl(0 70% 52% / 0.4)",
                        }}
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
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-50"
                      style={{ background: "hsl(199 70% 32% / 0.5)", color: "hsl(199 75% 84%)" }}
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
          <div className={isManager ? "" : ""}>
            <Button
              onClick={cancel}
              disabled={!!busy}
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
            >
              <Ban className="h-4 w-4" />
              {busy === "cancel" ? "Cancelling…" : "Cancel booking"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
