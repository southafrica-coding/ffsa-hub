"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionBar } from "@/components/ffsa";
import { Label } from "@/components/ui/label";
import { Check, X, Ban } from "lucide-react";
import { useBookingStatus } from "./status-context";

export function BookingActions({
  bookingId,
  hasSeries,
  canApprove,
  canCancel,
}: {
  bookingId: string;
  hasSeries: boolean;
  canApprove: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const { status, setStatus } = useBookingStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [applyToSeries, setApplyToSeries] = useState(false);

  const isPending = status === "pending";
  const isActive = status === "pending" || status === "approved";

  const showDecide = canApprove && isPending;
  const showCancel = canCancel && isActive;

  if (!showDecide && !showCancel) return null;

  async function decide(decision: "approved" | "denied") {
    const prev = status;
    setBusy(decision);
    setStatus(decision); // optimistic — pill flips + buttons collapse instantly
    try {
      const res = await fetch(`/api/bookings/${bookingId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: note.trim() || null,
          applyToSeries: hasSeries && applyToSeries,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(prev);
        setBusy(null);
        toast.error(json.error ?? "Could not update the booking.");
        return;
      }
      toast.success(decision === "approved" ? "Booking approved." : "Booking denied.");
      router.refresh();
    } catch {
      setStatus(prev);
      setBusy(null);
      toast.error("Network error — please try again.");
    }
  }

  async function cancel(seriesWide: boolean) {
    if (seriesWide && !window.confirm("Cancel every date in this weekly series?")) return;
    const prev = status;
    setBusy(seriesWide ? "cancel-series" : "cancel");
    setStatus("cancelled"); // optimistic
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel: true, applyToSeries: seriesWide }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(prev);
        setBusy(null);
        toast.error(json.error ?? "Could not cancel the booking.");
        return;
      }
      toast.success(seriesWide ? "Series cancelled." : "Booking cancelled.");
      router.refresh();
    } catch {
      setStatus(prev);
      setBusy(null);
      toast.error("Network error — please try again.");
    }
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Decision" />
      <div className="space-y-4 p-6">
        {showDecide && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="decision-note">Decision note (optional)</Label>
              <textarea
                id="decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Approved — please confirm set-up time with the team."
                className="flex w-full"
              />
            </div>
            {hasSeries && (
              <label className="flex items-center gap-2 !text-sm !normal-case !tracking-normal">
                <input
                  type="checkbox"
                  checked={applyToSeries}
                  onChange={(e) => setApplyToSeries(e.target.checked)}
                />
                Apply to all pending dates in this weekly series
              </label>
            )}
            {/* Approve is the black primary; deny is the outlined escape. Yellow
                is reserved for the one needs-you band per screen. */}
            <div className="flex gap-2">
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
            </div>
          </div>
        )}

        {showCancel && (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            <Button
              onClick={() => cancel(false)}
              disabled={!!busy}
              variant="ghost"
              size="sm"
              className="gap-1"
            >
              <Ban className="h-4 w-4" />
              {busy === "cancel" ? "Cancelling…" : "Cancel booking"}
            </Button>
            {hasSeries && (
              <Button
                onClick={() => cancel(true)}
                disabled={!!busy}
                variant="ghost"
                size="sm"
                className="gap-1"
              >
                <Ban className="h-4 w-4" />
                {busy === "cancel-series" ? "Cancelling…" : "Cancel whole series"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
