"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { grossUpToCover, type FeeProfile } from "@/lib/payments/pricing";
import { currencySymbol, formatMoney } from "@/lib/currencies";

type TicketType = {
  id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  target_net_cents: number;
  display_price_cents: number;
  capacity: number | null;
  quantity_sold: number;
  max_per_order: number | null;
  sales_start_at: string | null;
  sales_end_at: string | null;
  is_active: boolean;
  sort_order: number;
};

function previewDisplayCents(
  pricingMode: "fixed" | "pwyw",
  targetNetCents: number,
  profiles: FeeProfile[]
): number {
  if (targetNetCents <= 0) return 0;
  if (pricingMode === "pwyw") return targetNetCents;
  if (profiles.length === 0) return targetNetCents;
  return grossUpToCover(targetNetCents, profiles);
}

function toIsoOrNull(dtLocal: string): string | null {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function TicketTypesManager({
  eventId,
  ticketTypes,
  feeProfiles,
  currency,
}: {
  eventId: string;
  ticketTypes: TicketType[];
  feeProfiles: FeeProfile[];
  currency: string;
}) {
  const router = useRouter();
  // Prices are in the event's currency; feeProfiles are already the
  // rates for that currency (fetched per-currency in page.tsx).
  const money = (cents: number) => formatMoney(cents, currency);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add-form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pricingMode, setPricingMode] = useState<"fixed" | "pwyw">("fixed");
  const [targetAmount, setTargetAmount] = useState("");
  const [capacity, setCapacity] = useState("");
  const [maxPerOrder, setMaxPerOrder] = useState("");
  const [salesStart, setSalesStart] = useState("");
  const [salesEnd, setSalesEnd] = useState("");

  function reset() {
    setName("");
    setDescription("");
    setPricingMode("fixed");
    setTargetAmount("");
    setCapacity("");
    setMaxPerOrder("");
    setSalesStart("");
    setSalesEnd("");
    setErr(null);
  }

  const targetNetCents = Math.max(
    0,
    Math.round((Number.parseFloat(targetAmount) || 0) * 100)
  );
  const previewCents = previewDisplayCents(pricingMode, targetNetCents, feeProfiles);

  async function add() {
    if (!name.trim()) {
      setErr("Tier name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/events/${eventId}/ticket-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        pricing_mode: pricingMode,
        target_net_cents: targetNetCents,
        capacity: capacity ? Number.parseInt(capacity, 10) : null,
        max_per_order: maxPerOrder ? Number.parseInt(maxPerOrder, 10) : null,
        sales_start_at: toIsoOrNull(salesStart),
        sales_end_at: toIsoOrNull(salesEnd),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add tier");
      return;
    }
    setAdding(false);
    reset();
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this tier?")) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/ticket-types/${id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to delete");
      return;
    }
    router.refresh();
  }

  async function toggleActive(t: TicketType) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/ticket-types/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to update");
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Ticket tiers</CardTitle>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            + Add tier
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Each tier has a target net (what FFSA keeps) and a grossed-up display
          price that buyers pay. Early-bird is just a tier with a sales-end date.
        </p>

        {ticketTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No tiers yet.</p>
        ) : (
          <ul className="space-y-2">
            {ticketTypes.map((t) => (
              <li
                key={t.id}
                className="flex items-start justify-between gap-3 border rounded p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{t.name}</p>
                    {!t.is_active && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        inactive
                      </span>
                    )}
                    {t.pricing_mode === "pwyw" && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        pay what you want
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Net {money(t.target_net_cents)} → buyer pays{" "}
                    {money(t.display_price_cents)}
                    {" · "}
                    {t.capacity == null
                      ? `${t.quantity_sold} sold`
                      : `${t.quantity_sold} / ${t.capacity} sold`}
                    {t.max_per_order ? ` · max ${t.max_per_order}/order` : ""}
                  </p>
                  {(t.sales_start_at || t.sales_end_at) && (
                    <p className="text-xs text-muted-foreground">
                      Sales:
                      {t.sales_start_at
                        ? ` from ${new Date(t.sales_start_at).toLocaleString()}`
                        : ""}
                      {t.sales_end_at
                        ? ` until ${new Date(t.sales_end_at).toLocaleString()}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(t)}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {t.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    disabled={busy || t.quantity_sold > 0}
                    title={
                      t.quantity_sold > 0
                        ? "Can't delete a tier with sales. Deactivate instead."
                        : undefined
                    }
                    className="text-xs text-red-600 hover:underline disabled:text-gray-300 disabled:no-underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="border-t pt-3 space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tier name (e.g. General, VIP, Student, Early Bird)"
              className="w-full border rounded px-2 py-1.5 text-sm"
              disabled={busy}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm resize-none"
              disabled={busy}
            />
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={pricingMode === "fixed"}
                  onChange={() => setPricingMode("fixed")}
                  disabled={busy}
                />
                Fixed price
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={pricingMode === "pwyw"}
                  onChange={() => setPricingMode("pwyw")}
                  disabled={busy}
                />
                Pay what you want
              </label>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                {`${pricingMode === "fixed" ? "Target net" : "Minimum"} (${currency} ${currencySymbol(currency)})`}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="e.g. 250.00"
                className="w-full border rounded px-2 py-1.5 text-sm"
                disabled={busy}
              />
              {targetNetCents > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {pricingMode === "fixed"
                    ? `Buyer will see ${money(previewCents)} (grossed up to cover the processor fee).`
                    : `Buyer can enter ${money(previewCents)} or more; FFSA absorbs the fee from what they enter.`}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Capacity (optional)
                </label>
                <input
                  type="number"
                  min="0"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Max per order (optional)
                </label>
                <input
                  type="number"
                  min="1"
                  value={maxPerOrder}
                  onChange={(e) => setMaxPerOrder(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Sales start (optional)
                </label>
                <input
                  type="datetime-local"
                  value={salesStart}
                  onChange={(e) => setSalesStart(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Sales end (optional)
                </label>
                <input
                  type="datetime-local"
                  value={salesEnd}
                  onChange={(e) => setSalesEnd(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={add}
                disabled={busy}
                className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:bg-gray-300"
              >
                Save tier
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  reset();
                }}
                disabled={busy}
                className="px-3 py-1 rounded border text-xs hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
