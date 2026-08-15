"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreditCard, CheckCircle2, RefreshCw } from "lucide-react";
import { SectionBar } from "@/components/ffsa";

export function PaymentBlock({
  bookingId,
  paymentReceived,
  total,
  currency,
  latestStatus,
  xeroInvoiceNumber,
  canPay,
}: {
  bookingId: string;
  paymentReceived: boolean;
  total: number | null;
  currency: string;
  latestStatus: string | null;
  xeroInvoiceNumber: string | null;
  canPay: boolean;
}) {
  const isUsd = (currency || "").toUpperCase() === "USD";

  const [rate, setRate] = useState<number | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(isUsd);
  const [zar, setZar] = useState<string>(!isUsd && total != null ? String(total) : "");
  const [paying, setPaying] = useState(false);

  async function loadRate() {
    if (!isUsd || total == null) return;
    setRateLoading(true);
    try {
      const res = await fetch("/api/finance/outreach/exchange-rate?from=USD&to=ZAR");
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.rate === "number") {
        setRate(json.rate);
        setRateDate(json.date ?? null);
        setZar((total * json.rate).toFixed(2));
      }
    } catch {
      /* leave rate null — manual ZAR entry still works */
    } finally {
      setRateLoading(false);
    }
  }

  useEffect(() => {
    loadRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pay() {
    const rands = parseFloat(zar);
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
          fx_rate: isUsd ? rate : null,
          usd_amount: isUsd ? total : null,
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
    <div className="border border-ink bg-white">
      <SectionBar title="Payment" />
      <div className="space-y-3 p-6">

        {paymentReceived ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-grass-text">
            <CheckCircle2 className="h-4 w-4" />
            Payment received
            {xeroInvoiceNumber && (
              <span className="text-[color:var(--text-secondary)]">· Xero invoice {xeroInvoiceNumber}</span>
            )}
          </p>
        ) : canPay ? (
          <div className="space-y-3">
            {/* Live USD → ZAR conversion when the rate is quoted in USD */}
            {isUsd && total != null && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-rule bg-bone px-3 py-2 text-sm">
                <span className="font-semibold tabular-nums">
                  ${total.toFixed(2)} USD
                </span>
                <span className="text-[color:var(--text-tertiary)]">→</span>
                {rate ? (
                  <>
                    <span className="numeral text-[17px]">
                      R{(total * rate).toFixed(2)}
                    </span>
                    <span className="text-xs text-[color:var(--text-tertiary)]">
                      live rate R{rate.toFixed(2)}/$ {rateDate ? `· ${rateDate}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-[color:var(--text-tertiary)]">
                    {rateLoading ? "fetching live rate…" : "rate unavailable — enter ZAR manually"}
                  </span>
                )}
                <button
                  type="button"
                  onClick={loadRate}
                  disabled={rateLoading}
                  className="mono-label ml-auto inline-flex items-center gap-1 hover:!text-ink disabled:opacity-50"
                >
                  <RefreshCw className={"h-3 w-3 " + (rateLoading ? "animate-spin" : "")} />
                  Refresh
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label>Charge amount (ZAR)</label>
                <Input
                  type="number"
                  value={zar}
                  onChange={(e) => setZar(e.target.value)}
                  className="h-9 w-32"
                  placeholder="0.00"
                />
              </div>
              <Button onClick={pay} disabled={paying} size="sm" className="gap-1.5">
                <CreditCard className="h-4 w-4" />
                {paying ? "Starting…" : "Pay now (card)"}
              </Button>
              {latestStatus === "pending" && (
                <span className="text-xs text-[color:var(--text-tertiary)]">A payment is in progress…</span>
              )}
              {latestStatus === "failed" && (
                <span className="text-xs text-destructive">
                  Last attempt failed — try again.
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[color:var(--text-secondary)]">Awaiting payment.</p>
        )}

        <p className="text-[11px] text-[color:var(--text-tertiary)]">
          PayFast charges in ZAR. On success the booking is marked paid and an invoice
          posts to Xero (US renters → US Xero, others → SA Xero) under item code
          VehicleRent.
        </p>
      </div>
    </div>
  );
}
