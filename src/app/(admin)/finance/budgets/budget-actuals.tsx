"use client";

import { useEffect, useState } from "react";
import { SectionBar, StatusPill } from "@/components/ffsa";
import {
  actualAmountLabel,
  actualsTotalCents,
  interpretActuals,
  xeroProblemCopy,
  type ActualsView,
} from "@/lib/finance/budget-actuals-ui";

/**
 * Planned totals on the sheet are typed here. This block is the only place
 * Xero actuals appear, and only from GET /api/finance/budgets/[id]/actuals.
 */
export function BudgetActuals({
  budgetId,
  canRead,
  invalidBudgetId = false,
}: {
  budgetId: string | null;
  canRead: boolean;
  invalidBudgetId?: boolean;
}) {
  const [view, setView] = useState<ActualsView | { kind: "loading" } | { kind: "skipped"; message: string }>(
    () => skipped(budgetId, canRead, invalidBudgetId)
  );

  useEffect(() => {
    if (!canRead || !budgetId || invalidBudgetId) {
      setView(skipped(budgetId, canRead, invalidBudgetId));
      return;
    }
    let cancel = false;
    setView({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/finance/budgets/${budgetId}/actuals`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!cancel) setView(interpretActuals(res.status, body));
      } catch {
        if (!cancel) {
          setView({
            kind: "unavailable",
            message: "Xero actuals couldn't be read. They are not shown as zero.",
          });
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [budgetId, canRead, invalidBudgetId]);

  const message =
    view.kind === "skipped" || view.kind === "unavailable"
      ? view.message
      : view.kind === "loading"
        ? "Reading Xero…"
        : null;

  return (
    <div className="border border-ink" data-testid="budget-actuals">
      <SectionBar title="From Xero" meta={view.kind === "ready" ? view.data.currency : "Actuals"} />
      {message && <p className="px-4 py-4 text-[13px] leading-snug">{message}</p>}
      {view.kind === "ready" && <ActualsTable view={view} />}
    </div>
  );
}

function skipped(
  budgetId: string | null,
  canRead: boolean,
  invalidBudgetId: boolean
): { kind: "skipped"; message: string } {
  if (invalidBudgetId) {
    return { kind: "skipped", message: "That link isn't a budget id, so Xero wasn't asked. Actuals are not zero." };
  }
  if (!canRead) {
    return { kind: "skipped", message: "Xero actuals are for finance. They are not shown here, and they are not zero." };
  }
  if (!budgetId) {
    return {
      kind: "skipped",
      message:
        "This budget isn't saved, so nothing has been read from Xero. Actuals are not zero. A saved budget is read at its own link.",
    };
  }
  return { kind: "skipped", message: "Xero actuals haven't been read. They are not shown as zero." };
}

function ActualsTable({ view }: { view: Extract<ActualsView, { kind: "ready" }> }) {
  const { data } = view;
  const total = actualsTotalCents(data.lines);
  return (
    <>
      <p className="border-b border-rule px-4 py-3 text-[13px] leading-snug">
        {data.period.start} – {data.period.end}. Planned amounts are the budget. Actual amounts are Xero spend in
        that period, not outreach expenses.
        {data.xero.ok && data.xero.partial && " Xero returned part of the period."}
      </p>
      {!data.xero.ok && (
        <p className="border-b border-rule px-4 py-3 text-[13px] text-amber">{xeroProblemCopy(data.xero.reason)}</p>
      )}
      <div className="max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink bg-bone">
              <th className="mono-label px-4 py-2 font-bold">Line</th>
              <th className="mono-label px-4 py-2 text-right font-bold">Planned</th>
              <th className="mono-label px-4 py-2 text-right font-bold">Actual</th>
              <th className="mono-label px-4 py-2 text-right font-bold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[13px] text-[color:var(--text-secondary)]">
                  This budget has no lines to match against Xero.
                </td>
              </tr>
            )}
            {data.lines.map((line) => (
              <tr key={line.lineId} className="border-b border-rule">
                <td className="px-4 py-3 text-sm">{line.name}</td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                  {actualAmountLabel(line.plannedCents, data.currency)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                  {line.actualCents === null ? (
                    <span className="text-amber">Unknown</span>
                  ) : (
                    actualAmountLabel(line.actualCents, data.currency)
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                  {line.differenceCents === null ? (
                    <span className="text-amber">Unknown</span>
                  ) : (
                    actualAmountLabel(line.differenceCents, data.currency)
                  )}
                </td>
              </tr>
            ))}
            {total !== null && (
              <tr className="border-b border-ink">
                <td className="px-4 py-3 text-sm">Actual total</td>
                <td />
                <td className="px-4 py-3 text-right font-display text-[20px] font-black tabular-nums">
                  {actualAmountLabel(total, data.currency)}
                </td>
                <td />
              </tr>
            )}
            {total === null && data.lines.some((line) => line.actualCents === null) && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-[13px] text-[color:var(--text-secondary)]">
                  No actual total — a line finance has not coded stays unknown, not zero.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.unmatched.count > 0 && (
        <p className="border-t border-rule px-4 py-3 text-[13px]">
          <StatusPill tone="warn">{data.unmatched.count} unmatched</StatusPill>
          <span className="ml-2">
            {actualAmountLabel(data.unmatched.cents, data.currency)} in Xero did not match a single budget line, so it
            is not counted twice.
          </span>
        </p>
      )}
    </>
  );
}
