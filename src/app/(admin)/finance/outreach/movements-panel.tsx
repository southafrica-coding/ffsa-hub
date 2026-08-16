"use client";

import Link from "next/link";
import { SectionBar } from "@/components/ffsa";
import type {
  MoneyMovement,
  UnmatchedPayment,
} from "@/services/outreach-finance";

// Same shape as the rest of the module's dates: a plain date column read at
// midnight local so the day never slips backwards.
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
  });

const SOURCE_LABEL: Record<MoneyMovement["source"], string> = {
  fee_payment: "Fee received",
  fund_release: "Funds released",
  team_expense: "Team spend",
};

/**
 * One ledger line. Income carries the green; everything leaving carries plain
 * ink — the yellow on this screen belongs to the NeedsYou band alone.
 */
function LedgerRow({
  date,
  label,
  caption,
  amount,
  direction,
  href,
  formatCurrency,
}: {
  date: string;
  label: string;
  caption: string;
  amount: number;
  direction: "in" | "out";
  href?: string;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-2.5 last:border-0">
      <div className="min-w-0">
        {href ? (
          <Link
            href={href}
            className="block truncate text-[13px] hover:text-electric"
          >
            {label}
          </Link>
        ) : (
          <p className="truncate text-[13px]">{label}</p>
        )}
        <p className="mono-label mt-1">
          {fmtDate(date)} · {caption}
        </p>
      </div>
      <span
        className="tabular shrink-0 whitespace-nowrap font-mono text-[12.5px]"
        style={{ color: direction === "in" ? "var(--green-text)" : "var(--ink)" }}
      >
        {direction === "in" ? "+" : "−"}
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

/**
 * The dashboard's right-hand column: what has actually moved, and — pinned to
 * the bottom — the money in that nobody has tied to a bank line yet.
 *
 * Both blocks are read-only views of stored rows. `formatCurrency` is passed in
 * rather than redefined so every figure on this screen is formatted by the same
 * function (the pattern the team detail tabs already use).
 */
export function MovementsPanel({
  movements,
  unmatched,
  formatCurrency,
}: {
  movements: MoneyMovement[];
  unmatched: { count: number; rows: UnmatchedPayment[] };
  formatCurrency: (amount: number) => string;
}) {
  // Nothing to say, nothing drawn — an empty panel is worse than no panel.
  if (movements.length === 0 && unmatched.count === 0) return null;

  return (
    <aside className="flex flex-col gap-7 lg:h-full">
      {movements.length > 0 && (
        <div className="border border-ink">
          <SectionBar
            title="Recent movements"
            meta={`Last ${movements.length}`}
          />
          {movements.map((m) => (
            <LedgerRow
              key={m.id}
              date={m.date}
              label={m.label}
              caption={SOURCE_LABEL[m.source]}
              amount={m.amount}
              direction={m.direction}
              href={m.href}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>
      )}

      {unmatched.count > 0 && (
        // mt-auto pins this block to the foot of the column, per the recipe.
        <div className="mt-auto border border-ink">
          <SectionBar
            title="Unmatched payments"
            meta={`${unmatched.count} ${unmatched.count === 1 ? "payment" : "payments"}`}
          />
          <p className="border-b border-rule px-5 py-3 text-[12px] leading-snug text-[color:var(--text-secondary)]">
            Fee payments taken by EFT or card with no bank reference recorded —
            money received that has not been matched to a bank line.
          </p>
          {unmatched.rows.map((p) => (
            <LedgerRow
              key={p.id}
              date={p.date}
              label={p.label}
              caption={`${p.method.toUpperCase()} · no reference`}
              amount={p.amount}
              direction="in"
              href={p.href}
              formatCurrency={formatCurrency}
            />
          ))}
          {unmatched.count > unmatched.rows.length && (
            <p className="mono-label px-5 py-2.5">
              {unmatched.count - unmatched.rows.length} older not shown
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
