"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, CheckCircle2 } from "lucide-react";

export function PaymentBlock({
  bookingId,
  paymentReceived,
  total,
  latestStatus,
  xeroInvoiceNumber,
  canPay,
}: {
  bookingId: string;
  paymentReceived: boolean;
  total: number | null;
  latestStatus: string | null;
  xeroInvoiceNumber: string | null;
  canPay: boolean;
}) {
  const [amount, setAmount] = useState(total != null ? String(total) : "");
  const [paying, setPaying] = useState(false);

  async function pay() {
    const rands = parseFloat(amount);
    if (!rands || rands <= 0) {
      toast.error("Enter an amount to charge.");
      return;
    }
    setPaying(true);
    try {
      const res = await fetch("/api/vehicles/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bookingId,
          amount_cents: Math.round(rands * 100),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.redirectUrl) {
        setPaying(false);
        toast.error(json.error ?? "Could not start the payment.");
        return;
      }
      window.location.href = json.redirectUrl;
    } catch {
      setPaying(false);
      toast.error("Network error — please try again.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          Payment
        </h2>

        {paymentReceived ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "hsl(142 52% 60%)" }}>
            <CheckCircle2 className="h-4 w-4" />
            Payment received
            {xeroInvoiceNumber && (
              <span className="text-muted-foreground">· Xero invoice {xeroInvoiceNumber}</span>
            )}
          </p>
        ) : canPay ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Amount to charge (ZAR)</label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 w-32"
                placeholder="0.00"
              />
            </div>
            <Button onClick={pay} disabled={paying} size="sm" className="gap-1.5">
              <CreditCard className="h-4 w-4" />
              {paying ? "Starting…" : "Pay now (card)"}
            </Button>
            {latestStatus === "pending" && (
              <span className="text-xs text-muted-foreground">A payment is in progress…</span>
            )}
            {latestStatus === "failed" && (
              <span className="text-xs" style={{ color: "hsl(0 70% 66%)" }}>
                Last attempt failed — try again.
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Awaiting payment.</p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Card payment is processed by PayFast in ZAR. On success the booking is marked
          paid and an invoice posts to Xero using the vehicle&apos;s item code.
        </p>
      </CardContent>
    </Card>
  );
}
