"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DollarSign, Loader2 } from "lucide-react";
import { CurrencySelect } from "@/components/ui/currency-select";

const PAYMENT_METHODS = [
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);

export function RecordPaymentDialog({
  studentFeeId,
  studentName,
  balance,
}: {
  studentFeeId: string;
  studentName: string;
  balance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);

  const [form, setForm] = useState({
    amount_zar: "",
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "eft",
    reference: "",
    currency_paid: "",
    currency_amount: "",
    exchange_rate: "",
    notes: "",
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function fetchExchangeRate() {
    const currency = form.currency_paid;
    if (!currency || currency === "ZAR") return;
    setFetchingRate(true);
    try {
      const res = await fetch(
        `/api/finance/outreach/exchange-rate?from=${currency}&to=ZAR`
      );
      if (!res.ok) {
        toast.error("Failed to fetch exchange rate");
        return;
      }
      const { rate } = await res.json();
      const exchangeRate = 1 / rate;
      setForm((prev) => {
        const next = { ...prev, exchange_rate: exchangeRate.toFixed(6) };
        if (next.currency_amount && Number(next.currency_amount) > 0) {
          next.amount_zar = (
            Number(next.currency_amount) / exchangeRate
          ).toFixed(2);
        }
        return next;
      });
      toast.success(`Rate fetched: 1 ${currency} = ${rate.toFixed(6)} ZAR`);
    } catch {
      toast.error("Exchange rate service unavailable");
    } finally {
      setFetchingRate(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/finance/school-fees/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_fee_id: studentFeeId,
          payment_date: form.payment_date,
          amount_zar: Number(form.amount_zar),
          payment_method: form.payment_method,
          reference: form.reference || null,
          currency_paid: form.currency_paid || null,
          currency_amount: form.currency_amount
            ? Number(form.currency_amount)
            : null,
          exchange_rate: form.exchange_rate
            ? Number(form.exchange_rate)
            : null,
          notes: form.notes || null,
        }),
      });

      if (res.ok) {
        toast.success("Payment recorded");
        setOpen(false);
        setForm({
          amount_zar: "",
          payment_date: new Date().toISOString().slice(0, 10),
          payment_method: "eft",
          reference: "",
          currency_paid: "",
          currency_amount: "",
          exchange_rate: "",
          notes: "",
        });
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to record payment");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  const amountAfter = balance - Number(form.amount_zar || 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" onClick={(e) => e.stopPropagation()}>
          <DollarSign className="mr-1 h-3 w-3" />
          Pay
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Record Payment — {studentName}</DialogTitle>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          Current balance:{" "}
          <span className="font-mono font-medium text-foreground">
            {formatCurrency(balance)}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount (ZAR) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.amount_zar}
                onChange={(e) => updateField("amount_zar", e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Payment Date *</Label>
              <DateInput
                required
                value={form.payment_date}
                onChange={(v) => updateField("payment_date", v)}
              />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <Select
                value={form.payment_method}
                onValueChange={(v) => updateField("payment_method", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference</Label>
              <Input
                value={form.reference}
                onChange={(e) => updateField("reference", e.target.value)}
                placeholder="Bank ref..."
              />
            </div>
          </div>

          {/* Multi-currency section */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Paid in foreign currency? (optional)
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <CurrencySelect
                  allowNone
                  exclude={["ZAR"]}
                  placeholder="Currency"
                  value={form.currency_paid}
                  onChange={(v) => updateField("currency_paid", v)}
                />
              </div>
              <div>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.currency_amount}
                  onChange={(e) =>
                    updateField("currency_amount", e.target.value)
                  }
                  placeholder="Amount"
                  className="text-xs"
                />
              </div>
              <div className="flex gap-1">
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.exchange_rate}
                  onChange={(e) =>
                    updateField("exchange_rate", e.target.value)
                  }
                  placeholder="Rate"
                  className="text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-xs px-2"
                  disabled={!form.currency_paid || fetchingRate}
                  onClick={fetchExchangeRate}
                >
                  {fetchingRate ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Fetch"
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Payment notes..."
              rows={2}
            />
          </div>

          {form.amount_zar && (
            <div className="text-sm">
              Balance after payment:{" "}
              <span
                className={`font-mono font-medium ${
                  amountAfter > 0 ? "text-destructive" : "text-[color:var(--green-text)]"
                }`}
              >
                {formatCurrency(amountAfter)}
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !form.amount_zar}
            >
              {loading ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
