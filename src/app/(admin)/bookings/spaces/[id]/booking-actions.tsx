"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionBar } from "@/components/ffsa";
import { Label } from "@/components/ui/label";
import { Check, X, Ban } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useBookingStatus } from "./status-context";
import { ClashPanel, overrideBody, type ClashConflict } from "../clash-panel";

// An approval the server refused because the space is taken (409).
type Clash = { conflicts: ClashConflict[]; canOverride: boolean; error: string };

const CANNOT_OVERRIDE_HINT = "Deny it, or ask the requester to move it.";

// A 409 with nobody named (the re-read missed the holder). Never show the
// API's booker-facing blockLead, which says "pick another time".
const APPROVE_RACE_FALLBACK =
  "This time has just been booked by someone else, so it can't be approved as it stands. Deny it, or ask the requester to move it.";
const APPROVE_RACE_FALLBACK_MANAGER =
  "This time has just been booked by someone else, so it can't be approved as it stands.";

export function BookingActions({
  bookingId,
  hasSeries,
  canApprove,
  canCancel,
  venueName = null,
}: {
  bookingId: string;
  hasSeries: boolean;
  canApprove: boolean;
  canCancel: boolean;
  venueName?: string | null;
}) {
  const router = useRouter();
  const { status, setStatus } = useBookingStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [confirmSeriesOpen, setConfirmSeriesOpen] = useState(false);
  const [clash, setClash] = useState<Clash | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");

  const isPending = status === "pending";
  const isActive = status === "pending" || status === "approved";

  const showDecide = canApprove && isPending;
  const showCancel = canCancel && isActive;

  // A clash with nobody named (a race the re-read missed) only explains
  // itself; approving again re-checks the space.
  const blocked = !!clash && clash.conflicts.length > 0;

  if (!showDecide && !showCancel) return null;

  function clearClash() {
    setClash(null);
    setOverriding(false);
    setReason("");
  }

  async function decide(decision: "approved" | "denied") {
    if (decision === "denied") clearClash();
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
          ...(decision === "approved" ? overrideBody(overriding, reason) : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 || json.blocked) {
        // Keep the clash in view beside the buttons, not in a passing toast.
        setStatus(prev);
        setBusy(null);
        const canOverride = json.canOverride === true;
        setClash({
          conflicts: Array.isArray(json.conflicts) ? json.conflicts : [],
          canOverride,
          error: json.error ?? "This space has just been booked at that time.",
        });
        if (!canOverride) {
          setOverriding(false);
          setReason("");
        }
        return;
      }
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
    setConfirmSeriesOpen(false);
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
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={applyToSeries}
                  onChange={(e) => {
                    setApplyToSeries(e.target.checked);
                    clearClash(); // a different set of dates to approve
                  }}
                />
                {/* Body text, not the global mono label style. */}
                <span className="!font-sans text-sm !font-normal normal-case !tracking-normal !text-[color:var(--text-primary)]">
                  Apply to all pending dates in this weekly series
                </span>
              </label>
            )}
            {/* Refused approval — the same panel as the create and edit forms */}
            {clash && clash.conflicts.length > 0 && (
              <ClashPanel
                conflicts={clash.conflicts}
                venueName={venueName}
                canOverride={clash.canOverride}
                overriding={overriding}
                onOverridingChange={setOverriding}
                reason={reason}
                onReasonChange={setReason}
                cannotOverrideHint={CANNOT_OVERRIDE_HINT}
                variant="approve"
              />
            )}
            {clash && clash.conflicts.length === 0 && (
              <p
                role="alert"
                className="break-words border border-ink bg-bone p-3 text-sm text-[color:var(--text-primary)]"
              >
                {clash.canOverride ? APPROVE_RACE_FALLBACK_MANAGER : APPROVE_RACE_FALLBACK}
              </p>
            )}
            {/* Approve is the black primary; deny is the outlined escape. Yellow
                is reserved for the one needs-you band per screen. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => decide("approved")}
                disabled={!!busy || (blocked && !(overriding && reason.trim()))}
                className="inline-flex min-h-11 items-center gap-1.5 border border-ink bg-ink px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {busy === "approved"
                  ? "Approving…"
                  : blocked
                    ? overriding
                      ? "Book anyway"
                      : "Time taken"
                    : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => decide("denied")}
                disabled={!!busy}
                className="inline-flex min-h-11 items-center gap-1.5 border border-destructive px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-destructive disabled:opacity-50"
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
                onClick={() => setConfirmSeriesOpen(true)}
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

      <Dialog open={confirmSeriesOpen} onOpenChange={setConfirmSeriesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel whole series?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will cancel every upcoming date in this weekly series. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmSeriesOpen(false)}>
              Keep series
            </Button>
            <button
              type="button"
              onClick={() => cancel(true)}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 border border-destructive px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-destructive disabled:opacity-50"
            >
              <Ban className="h-4 w-4" />
              Yes, cancel series
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
