import { StatusPill, type Tone } from "@/components/ffsa";
import { FeeProgressBar } from "@/components/finance/fee-progress-bar";
import type { MyChargeState, MyFeeAccount } from "@/services/my-school-fees";

// One school's fees as the student sees them: the same bar the staff screens
// use, then every payment on their schedule as a two-line row.

/** R 38 800 — grouped with a space, matching the rest of this screen. */
function rands(amount: number): string {
  const whole = Math.round(amount * 100) % 100 === 0;
  return `R ${amount
    .toLocaleString("en-ZA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
    .replace(/,(?=\d{3})/g, " ")}`;
}

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const STATE: Record<MyChargeState, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "good" },
  part_paid: { label: "Part paid", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
  invoiced: { label: "Invoiced", tone: "warn" },
  upcoming: { label: "Upcoming", tone: "quiet" },
  arranging: { label: "Being arranged", tone: "quiet" },
};

export function MyFeeAccountCard({ account }: { account: MyFeeAccount }) {
  const { balance: b, charges } = account;
  return (
    <div className="min-w-0 bg-white">
      <div className="min-w-0 space-y-3 border-b border-rule px-5 py-5 md:px-8">
        <div className="font-display text-[19px] font-black uppercase leading-none">{account.programName}</div>
        <FeeProgressBar balance={b} audience="student" />
        {b.heldCount > 0 && (
          <p className="text-xs text-[color:var(--text-secondary)]">
            Some payments are being arranged with the finance team — they&apos;ll appear here with dates once
            they&apos;re set.
          </p>
        )}
      </div>

      <ul>
        {charges.map((c) => {
          const s = STATE[c.state];
          const owing = Math.max(0, c.amount - c.paid);
          return (
            <li key={c.id} className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3 last:border-0 md:px-8">
              <div className="min-w-0">
                {/* Line one: what it is. */}
                <div className="truncate text-[14px] font-semibold">{c.label}</div>
                {/* Line two: when, which invoice, what's left — on one line. */}
                <div className="mono-label mt-1 truncate">
                  {c.state === "paid"
                    ? `Paid${c.paidAt ? ` ${fmtDate(c.paidAt)}` : ""}`
                    : c.state === "arranging"
                      ? "Date to be confirmed"
                      : `Due ${fmtDate(c.dueDate)}`}
                  {c.invoiceNumber ? ` · ${c.invoiceNumber}` : ""}
                </div>
              </div>
              {/* The amount never truncates — it's the figure that matters. */}
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="whitespace-nowrap font-mono text-[13px]">{rands(c.amount)}</span>
                {c.state !== "paid" && c.paid > 0 && (
                  <span className="whitespace-nowrap font-mono text-[10px] text-[color:var(--text-secondary)]">
                    {rands(owing)} left
                  </span>
                )}
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
