"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RotateCcw } from "lucide-react";

type RefundAllResult = {
  attempted: number;
  refunded: number;
  failed: number;
  totalRefundedCents: number;
  failures: Array<{ orderId: string; error: string }>;
};

// Standalone "refund every outstanding order" action for the Orders tab.
// Independent of event status — you can refund everyone whether or not the
// event is marked cancelled. If the event has a cancellation note set, it's
// included in each buyer's refund email automatically (server-side).
export function RefundAllButton({
  eventId,
  outstandingCount,
  outstandingCents,
  formatMoney,
}: {
  eventId: string;
  /** Orders still holding money (paid + partially refunded). */
  outstandingCount: number;
  outstandingCents: number;
  formatMoney: (cents: number) => string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RefundAllResult | null>(null);

  if (outstandingCount === 0) return null;

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/orders/refund-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Couldn't run the bulk refund. Please try again.");
      return;
    }
    const data = (await res.json()) as RefundAllResult;
    setResult(data);
    if (data.failed === 0) {
      toast.success(
        `Refunded ${data.refunded} order${data.refunded === 1 ? "" : "s"} · ${formatMoney(data.totalRefundedCents)}`
      );
    } else {
      toast.warning(
        `${data.refunded} refunded, ${data.failed} need attention.`
      );
    }
    router.refresh();
  }

  function onOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      // Reset for a clean next run once closed.
      setReason("");
      setErr(null);
      setResult(null);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Refund all
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Refund all ticket holders</DialogTitle>
          </DialogHeader>

          {result ? (
            <div className="space-y-3 text-sm">
              <p>
                Refunded <strong>{result.refunded}</strong> of{" "}
                {result.attempted} order{result.attempted === 1 ? "" : "s"} —{" "}
                {formatMoney(result.totalRefundedCents)} returned.
              </p>
              {result.failed > 0 && (
                <div className="space-y-1">
                  <p className="text-destructive">
                    {result.failed} order{result.failed === 1 ? "" : "s"}{" "}
                    couldn&apos;t be refunded automatically (e.g. paid by EFT or
                    an unconfigured provider). Refund these from the row actions
                    or in the provider:
                  </p>
                  <ul className="space-y-1 max-h-40 overflow-auto border p-2 bg-muted/30">
                    {result.failures.map((f) => (
                      <li key={f.orderId} className="text-xs">
                        <span className="font-mono">{f.orderId.slice(0, 8)}</span>{" "}
                        — <span className="text-muted-foreground">{f.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This refunds <strong>{outstandingCount}</strong> order
                {outstandingCount === 1 ? "" : "s"} still holding money —{" "}
                <strong>{formatMoney(outstandingCents)}</strong> in total — back
                to the buyers via Stripe / PayFast, voids their tickets and
                emails each of them. This moves real money and can&apos;t be
                undone.
              </p>
              <p className="text-xs text-muted-foreground">
                If you&apos;ve set a cancellation note on this event, it&apos;s
                included in every refund email. PayFast refunds only work in
                live mode.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Internal note (optional)
                </label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. Event cancelled — bulk refund"
                  disabled={busy}
                />
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={run}
                  disabled={busy}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy
                    ? "Refunding…"
                    : `Refund ${outstandingCount} order${outstandingCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
