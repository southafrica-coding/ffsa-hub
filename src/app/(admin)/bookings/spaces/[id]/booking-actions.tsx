"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card>
      <CardContent className="pt-6 space-y-4">
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
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            {hasSeries && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applyToSeries}
                  onChange={(e) => setApplyToSeries(e.target.checked)}
                  className="rounded border-input"
                />
                Apply to all pending dates in this weekly series
              </label>
            )}
            <div className="flex gap-2">
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
            </div>
          </div>
        )}

        {showCancel && (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              onClick={() => cancel(false)}
              disabled={!!busy}
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
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
                className="gap-1 text-muted-foreground"
              >
                <Ban className="h-4 w-4" />
                {busy === "cancel-series" ? "Cancelling…" : "Cancel whole series"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
