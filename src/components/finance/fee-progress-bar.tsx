import { formatZAR } from "@/lib/finance/billing";
import type { StudentBalance } from "@/lib/finance/student-balance";

// A student's (or a school's) fees at a glance: one bar split into paid,
// overdue, invoiced-not-yet-due and not-yet-invoiced, with the exact rands
// underneath. Server-safe — no client JS.

const SEGMENTS = [
  { key: "paid", label: "Paid", cls: "bg-grass" },
  { key: "overdue", label: "Overdue", cls: "bg-destructive" },
  { key: "invoicedNotDue", label: "Invoiced", cls: "bg-amber" },
  { key: "notInvoiced", label: "Not yet invoiced", cls: "bg-rule-strong" },
] as const;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function FeeProgressBar({
  balance,
  size = "full",
}: {
  balance: StudentBalance;
  /** "full" = bar + figures + legend; "compact" = bar + one line (rosters). */
  size?: "full" | "compact";
}) {
  const b = balance;
  if (b.total <= 0) {
    return <span className="font-mono text-[10px] text-[color:var(--text-secondary)]">NOTHING SCHEDULED</span>;
  }

  const width = (n: number) => `${Math.max(0, (n / b.total) * 100)}%`;
  const summary = `${formatZAR(b.paid)} of ${formatZAR(b.total)} paid (${b.percentPaid}%)`;

  return (
    <div className={size === "compact" ? "min-w-[140px] space-y-1" : "space-y-2"}>
      <div
        className={`flex w-full overflow-hidden border border-ink bg-white ${size === "compact" ? "h-2" : "h-3"}`}
        role="img"
        aria-label={`${summary}. ${formatZAR(b.overdue)} overdue, ${formatZAR(b.invoicedNotDue)} invoiced and not yet due, ${formatZAR(b.notInvoiced)} not yet invoiced.`}
      >
        {SEGMENTS.map((s) =>
          b[s.key] > 0 ? <span key={s.key} className={s.cls} style={{ width: width(b[s.key]) }} /> : null
        )}
      </div>

      {size === "compact" ? (
        <p className="font-mono text-[10px] leading-tight tracking-[0.04em]">
          <span className="font-bold">{b.percentPaid}%</span>{" "}
          <span className="text-[color:var(--text-secondary)]">· {formatZAR(b.outstanding)} left</span>
          {b.overdue > 0 && <span className="font-bold text-destructive"> · {formatZAR(b.overdue)} overdue</span>}
        </p>
      ) : (
        <>
          <p className="text-[13px]">
            <span className="font-semibold">{summary}</span>
            <span className="text-[color:var(--text-secondary)]"> · {formatZAR(b.outstanding)} left</span>
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {SEGMENTS.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 border border-ink ${s.cls}`} />
                {s.label} <span className="font-mono">{formatZAR(b[s.key])}</span>
              </li>
            ))}
          </ul>
          {(b.next || b.heldCount > 0) && (
            <p className="text-xs text-[color:var(--text-secondary)]">
              {b.next && (
                <>
                  Next: {formatZAR(b.next.amount)} due {fmtDate(b.next.dueDate)}
                </>
              )}
              {b.heldCount > 0 && (
                <span className="text-amber">
                  {b.next ? " · " : ""}
                  {b.heldCount} charge{b.heldCount === 1 ? "" : "s"} held for a decision
                </span>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
