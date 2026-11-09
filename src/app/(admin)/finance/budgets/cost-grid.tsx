"use client";

import { StatusPill } from "@/components/ffsa";
import {
  formatBudgetMoney,
  lineMath,
  type BudgetCurrency,
  type SheetLine,
} from "@/lib/finance/budget-sheet";
import type { BudgetLineKind } from "@/lib/finance/budget-lines";

const cellInput =
  "h-11 w-full bg-transparent px-2 text-sm text-ink outline-none focus:bg-bone";

export function CostGrid({
  kind,
  lines,
  currency,
  driverLabel,
  driverValue,
  onChange,
  onRemove,
}: {
  kind: BudgetLineKind;
  lines: SheetLine[];
  currency: BudgetCurrency | null;
  driverLabel: string;
  driverValue: number | null;
  onChange: (id: string, patch: Partial<SheetLine>) => void;
  onRemove: (id: string) => void;
}) {
  const mine = lines.filter((line) => line.kind === kind);
  const factorLabel = kind === "fixed" ? "Quantity" : "Multiplier";
  const columns = kind === "fixed" ? 9 : 11;

  return (
    <div className="max-w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead>
          <tr className="border-b border-ink bg-bone">
            <th className="mono-label px-2 py-2 font-bold">Line</th>
            <th className="mono-label w-[120px] px-2 py-2 text-right font-bold">Amount</th>
            <th className="mono-label w-8 px-1 py-2 text-center font-bold">×</th>
            {kind === "variable" && (
              <>
                <th className="mono-label w-[88px] px-2 py-2 text-right font-bold">Times</th>
                <th className="mono-label w-8 px-1 py-2 text-center font-bold">×</th>
              </>
            )}
            <th className="mono-label w-[150px] px-2 py-2 text-right font-bold">{factorLabel}</th>
            <th className="mono-label w-8 px-1 py-2 text-center font-bold">=</th>
            <th className="mono-label w-[130px] px-2 py-2 text-right font-bold">Total</th>
            <th className="mono-label w-[120px] px-2 py-2 font-bold">Xero code</th>
            <th className="mono-label px-2 py-2 font-bold">Note</th>
            <th className="w-[88px] px-2 py-2" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {mine.length === 0 && (
            <tr>
              <td colSpan={columns} className="px-4 py-8 text-[13px] text-[color:var(--text-secondary)]">
                {kind === "variable"
                  ? "No variable costs yet. Add a line when a cost repeats."
                  : "No fixed costs yet. Add a line for a one-off purchase."}
              </td>
            </tr>
          )}
          {mine.map((line) => {
            const math = lineMath(line, driverValue);
            const who = line.name.trim() || "this line";
            return (
              <tr key={line.id} className="border-b border-rule align-top">
                <td className="p-0">
                  <input
                    aria-label={`Name for ${who}`}
                    className={cellInput}
                    value={line.name}
                    placeholder="What it is"
                    onChange={(e) => onChange(line.id, { name: e.target.value })}
                  />
                </td>
                <td className="p-0">
                  <input
                    aria-label={`Amount for ${who}`}
                    inputMode="decimal"
                    className={`${cellInput} text-right font-mono tabular-nums`}
                    value={line.amount}
                    placeholder="0.00"
                    onChange={(e) => onChange(line.id, { amount: e.target.value })}
                  />
                </td>
                <td className="px-1 text-center font-mono text-[12px] leading-[44px] text-[#7C786C]">×</td>
                {kind === "variable" && (
                  <>
                    <td className="p-0">
                      <input
                        aria-label={`Times for ${who}`}
                        inputMode="decimal"
                        className={`${cellInput} text-right font-mono tabular-nums`}
                        value={line.frequency}
                        onChange={(e) => onChange(line.id, { frequency: e.target.value })}
                      />
                    </td>
                    <td className="px-1 text-center font-mono text-[12px] leading-[44px] text-[#7C786C]">×</td>
                  </>
                )}
                <td className="p-0">
                  {line.usesDriver ? (
                    <div className="flex h-11 items-center justify-end px-2 font-mono text-sm tabular-nums">
                      {driverValue === null ? "—" : String(driverValue)}
                    </div>
                  ) : (
                    <input
                      aria-label={`${factorLabel} for ${who}`}
                      inputMode="decimal"
                      className={`${cellInput} text-right font-mono tabular-nums`}
                      value={line.multiplier}
                      onChange={(e) => onChange(line.id, { multiplier: e.target.value })}
                    />
                  )}
                  <label className="flex min-h-11 items-center gap-2 px-2 text-[12px] text-[color:var(--text-secondary)]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-black"
                      checked={line.usesDriver}
                      onChange={(e) => onChange(line.id, { usesDriver: e.target.checked })}
                    />
                    Uses {driverLabel.trim() || "the driver"}
                  </label>
                </td>
                <td className="px-1 text-center font-mono text-[12px] leading-[44px] text-[#7C786C]">=</td>
                <td className="px-2 py-2 text-right">
                  <div className="font-display text-[18px] font-black tabular-nums leading-none">
                    {math.ok ? formatBudgetMoney(math.cents, currency) : "—"}
                  </div>
                  {!math.ok && (
                    <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber">
                      {math.reason === "amount" ? "Needs an amount" : math.reason === "frequency" ? "Needs times" : "Needs a number"}
                    </div>
                  )}
                  {math.ok && math.driverMissing && (
                    <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber">
                      Driver not set
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <StatusPill tone={!line.codingStatus || line.codingStatus === "needs_coding" ? "warn" : "good"}>
                    {!line.codingStatus || line.codingStatus === "needs_coding" ? "Not coded" : "Mapped"}
                  </StatusPill>
                </td>
                <td className="p-0">
                  <input
                    aria-label={`Note for ${who}`}
                    className={cellInput}
                    value={line.notes}
                    placeholder="Note"
                    onChange={(e) => onChange(line.id, { notes: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      const label = line.name.trim() || "this line";
                      if ((line.name.trim() || line.amount.trim()) && !window.confirm(`Remove ${label}?`)) return;
                      onRemove(line.id);
                    }}
                    className="min-h-11 px-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#55524A] hover:text-ink"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
