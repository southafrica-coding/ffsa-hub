"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMoney } from "@/lib/currencies";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RefundableOrder = {
  id: string;
  buyer_first_name: string;
  buyer_last_name: string;
  buyer_email: string;
  total_cents: number;
  payment_provider: string | null;
  provider_payment_id: string | null;
  // The currency this order was sold in (orders.currency).
  currency: string | null;
};

const PROVIDER_LABEL: Record<string, string> = {
  payfast: "PayFast",
  stripe: "Stripe",
};

export function RefundDialog({
  eventId,
  order,
  alreadyRefundedCents,
  open,
  onOpenChange,
}: {
  eventId: string;
  order: RefundableOrder;
  alreadyRefundedCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const money = (cents: number) => formatMoney(cents, order.currency);
  const outstanding = order.total_cents - alreadyRefundedCents;

  // An order with no provider payment id can only ever be recorded,
  // never charged back — so default those to manual and say why.
  const canUseProvider = Boolean(
    order.payment_provider && order.provider_payment_id
  );
  const providerName = order.payment_provider
    ? (PROVIDER_LABEL[order.payment_provider] ?? order.payment_provider)
    : null;

  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState(!canUseProvider);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const amountCents = Math.round(Number.parseFloat(amount || "0") * 100);
  const amountValid =
    Number.isFinite(amountCents) && amountCents > 0 && amountCents <= outstanding;
  const isPartial = amountValid && amountCents < outstanding;

  async function submit(dryRun: boolean) {
    if (!amountValid) return;
    setBusy(true);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/events/${eventId}/orders/${order.id}/refund`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_cents: amountCents,
            reason: reason.trim() || null,
            method: manual ? "manual" : "provider",
            dry_run: dryRun,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
        emailSent?: boolean;
        isFullRefund?: boolean;
        dryRunPreview?: unknown;
        warning?: string;
      };

      if (!res.ok) {
        toast.error(data.error ?? "Refund failed");
        return;
      }

      if (dryRun) {
        setPreview(JSON.stringify(data.dryRunPreview ?? {}, null, 2));
        return;
      }

      // "pending" is normal for PayFast — the payout is queued and
      // there's no callback, so say so rather than implying it's done.
      const settled = data.status === "succeeded";
      if (data.warning) {
        toast.warning(data.warning);
        router.refresh();
        onOpenChange(false);
        return;
      }
      toast.success(
        manual
          ? `Recorded ${money(amountCents)} refunded outside the Hub.`
          : settled
            ? `${money(amountCents)} refunded via ${providerName}.`
            : `${money(amountCents)} submitted to ${providerName} — awaiting confirmation.`,
        {
          description: data.emailSent
            ? `${order.buyer_email} has been emailed.`
            : "The buyer was not emailed — check the email configuration.",
        }
      );
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Refund order #{order.id.slice(0, 8)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Buyer</span>
              <span>
                {order.buyer_first_name} {order.buyer_last_name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order total</span>
              <span>{money(order.total_cents)}</span>
            </div>
            {alreadyRefundedCents > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already refunded</span>
                <span>− {money(alreadyRefundedCents)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span className="text-muted-foreground">Refundable</span>
              <span>{money(outstanding)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Amount to refund (R)</Label>
            <Input
              id="refund-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!amountValid}
            />
            {!amountValid ? (
              <p className="text-xs text-destructive">
                Enter an amount between {money(1)} and {money(outstanding)}.
              </p>
            ) : isPartial ? (
              <p className="text-xs text-muted-foreground">
                Partial refund — the tickets on this order stay valid and will
                still scan at the door.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Full refund — the tickets will be voided and the seats released
                back to the tier.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Textarea
              id="refund-reason"
              rows={2}
              placeholder="Cancelled — couldn't travel"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="flex items-start gap-2.5 border p-3">
            <Checkbox
              id="refund-manual"
              checked={manual}
              disabled={!canUseProvider}
              onCheckedChange={(v) => setManual(v === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label
                htmlFor="refund-manual"
                className="text-sm font-normal leading-snug"
              >
                Money already refunded outside the Hub — record only
              </Label>
              <p className="text-xs text-muted-foreground">
                {canUseProvider
                  ? `Leave unticked and the Hub refunds the buyer through ${providerName} directly. Tick it for refunds you've already done yourself.`
                  : "This order has no card payment on file (EFT, comped, or placed before automated refunds), so it can only be recorded."}
              </p>
            </div>
          </div>

          {preview && (
            <div className="space-y-1.5">
              <Label>Request preview — nothing was sent</Label>
              <pre className="max-h-52 overflow-auto border bg-muted/40 p-2 text-[11px] leading-relaxed">
                {preview}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          {/* PayFast has no sandbox for refunds, so inspecting the signed
              payload is the only pre-flight check available. */}
          {!manual && canUseProvider ? (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy || !amountValid}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
            >
              Preview request
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => submit(false)}
              disabled={busy || !amountValid}
            >
              {busy
                ? "Working…"
                : manual
                  ? `Record ${money(amountValid ? amountCents : 0)}`
                  : `Refund ${money(amountValid ? amountCents : 0)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
