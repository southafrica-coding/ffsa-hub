"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currencySymbol, formatMoney } from "@/lib/currencies";

type TicketTypeLite = { id: string; name: string };
type PromoCode = {
  id: string;
  code: string;
  kind: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  applies_to_ticket_type_id: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
};

function describeValue(p: PromoCode, currency: string): string {
  if (p.kind === "percent") return `${p.percent_off}% off`;
  if (p.kind === "fixed_amount")
    return `${formatMoney(p.amount_off_cents ?? 0, currency)} off`;
  if (p.kind === "comp") return "Free (100% off)";
  return "—";
}

function toIsoOrNull(dtLocal: string): string | null {
  if (!dtLocal) return null;
  const d = new Date(dtLocal);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function PromoCodesManager({
  eventId,
  promoCodes,
  ticketTypes,
  currency,
}: {
  eventId: string;
  promoCodes: PromoCode[];
  ticketTypes: TicketTypeLite[];
  // Fixed-amount discounts are in the event's selling currency.
  currency: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add-form state
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed_amount" | "comp">("percent");
  const [percentOff, setPercentOff] = useState("");
  const [amountOff, setAmountOff] = useState(""); // major units of `currency`
  const [appliesTo, setAppliesTo] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");

  function reset() {
    setCode("");
    setKind("percent");
    setPercentOff("");
    setAmountOff("");
    setAppliesTo("");
    setMaxRedemptions("");
    setValidFrom("");
    setValidUntil("");
    setErr(null);
  }

  async function add() {
    if (!code.trim()) {
      setErr("Code is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      code: code.trim(),
      kind,
      applies_to_ticket_type_id: appliesTo || null,
      max_redemptions: maxRedemptions ? Number.parseInt(maxRedemptions, 10) : null,
      valid_from: toIsoOrNull(validFrom),
      valid_until: toIsoOrNull(validUntil),
    };
    if (kind === "percent") {
      const n = Number.parseFloat(percentOff);
      if (!(n > 0 && n <= 100)) {
        setBusy(false);
        setErr("Percent off must be 1–100.");
        return;
      }
      payload.percent_off = n;
    }
    if (kind === "fixed_amount") {
      const n = Number.parseFloat(amountOff);
      if (!(n > 0)) {
        setBusy(false);
        setErr("Amount off must be greater than 0.");
        return;
      }
      payload.amount_off_cents = Math.round(n * 100);
    }

    const res = await fetch(`/api/events/${eventId}/promo-codes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to add code");
      return;
    }
    setAdding(false);
    reset();
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this code?")) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/promo-codes/${id}`, {
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

  async function toggleActive(p: PromoCode) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/promo-codes/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to update");
      return;
    }
    router.refresh();
  }

  const tierLookup = new Map(ticketTypes.map((t) => [t.id, t.name]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Promo &amp; comp codes</CardTitle>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            + Add code
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Discount codes for promotions and 100%-off comp codes for staff,
          sponsors and scholarships.
        </p>

        {promoCodes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No codes yet.</p>
        ) : (
          <ul className="space-y-2">
            {promoCodes.map((p) => (
              <li
                key={p.id}
                className="flex items-start justify-between gap-3 border rounded p-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-mono font-medium">{p.code}</p>
                    {!p.is_active && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {describeValue(p, currency)}
                    {p.applies_to_ticket_type_id
                      ? ` · ${tierLookup.get(p.applies_to_ticket_type_id) ?? "specific tier"}`
                      : " · any tier"}
                    {p.max_redemptions
                      ? ` · ${p.redemption_count} / ${p.max_redemptions} used`
                      : ` · ${p.redemption_count} used`}
                  </p>
                  {(p.valid_from || p.valid_until) && (
                    <p className="text-xs text-muted-foreground">
                      Valid:
                      {p.valid_from
                        ? ` from ${new Date(p.valid_from).toLocaleString()}`
                        : ""}
                      {p.valid_until
                        ? ` until ${new Date(p.valid_until).toLocaleString()}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(p)}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {p.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    disabled={busy || p.redemption_count > 0}
                    title={
                      p.redemption_count > 0
                        ? "Can't delete a code that's been redeemed. Deactivate instead."
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
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code (e.g. EARLY2026, STAFF, SPONSOR)"
              className="w-full border rounded px-2 py-1.5 text-sm font-mono"
              disabled={busy}
            />
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Type
              </label>
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "percent" | "fixed_amount" | "comp")
                }
                className="w-full border rounded px-2 py-1.5 text-sm"
                disabled={busy}
              >
                <option value="percent">Percent off</option>
                <option value="fixed_amount">Fixed amount off</option>
                <option value="comp">Comp (100% off — free)</option>
              </select>
            </div>
            {kind === "percent" && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  % off
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={percentOff}
                  onChange={(e) => setPercentOff(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
            )}
            {kind === "fixed_amount" && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  {`Amount off (${currency} ${currencySymbol(currency)})`}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountOff}
                  onChange={(e) => setAmountOff(e.target.value)}
                  placeholder="e.g. 50.00"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Restrict to one tier (optional)
              </label>
              <select
                value={appliesTo}
                onChange={(e) => setAppliesTo(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm"
                disabled={busy}
              >
                <option value="">— any tier —</option>
                {ticketTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Max redemptions (optional)
                </label>
                <input
                  type="number"
                  min="1"
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
              <div />
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Valid from (optional)
                </label>
                <input
                  type="datetime-local"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  disabled={busy}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Valid until (optional)
                </label>
                <input
                  type="datetime-local"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
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
                Save code
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
