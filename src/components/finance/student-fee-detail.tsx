import { formatZAR } from "@/lib/finance/billing";
import type { StudentBalance } from "@/lib/finance/student-balance";
import type { ChargeDetail } from "@/services/school-balances";
import { StatusPill, type Tone } from "@/components/ffsa";
import { FeeProgressBar } from "@/components/finance/fee-progress-bar";

// One student's fees: the bar, then every charge on their schedule — due
// date, invoice, status and what's been paid against it.

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function chargeState(c: ChargeDetail, today: string): { label: string; tone: Tone } {
  const owing = c.amount_zar - c.amount_paid_zar;
  switch (c.status) {
    case "paid":
      return { label: "Paid", tone: "good" };
    case "cancelled":
      return { label: "Cancelled", tone: "quiet" };
    case "needs_decision":
      return { label: "Held", tone: "warn" };
    case "scheduled":
      return { label: "Not invoiced yet", tone: "quiet" };
    default: {
      if (c.amount_paid_zar > 0 && owing > 0) {
        return { label: c.due_date < today ? "Part-paid · overdue" : "Part-paid", tone: c.due_date < today ? "bad" : "warn" };
      }
      if (c.due_date < today) return { label: "Overdue", tone: "bad" };
      return { label: c.status === "generated" ? "Invoiced (draft)" : "Invoiced", tone: "warn" };
    }
  }
}

export function StudentFeeDetail({
  balance,
  charges,
  today,
}: {
  balance: StudentBalance;
  charges: ChargeDetail[];
  today: string;
}) {
  return (
    <section className="border border-ink bg-white">
      <div className="border-b border-rule px-4 py-3">
        <h2 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Payments</h2>
        <FeeProgressBar balance={balance} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-rule font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
              <th className="px-4 py-2">Charge</th>
              <th className="px-2 py-2">Due</th>
              <th className="px-2 py-2">Invoice</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => {
              const s = chargeState(c, today);
              return (
                <tr key={c.id} className={`border-b border-rule last:border-0 ${c.status === "cancelled" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2">{c.label}</td>
                  <td className="whitespace-nowrap px-2 py-2">{fmtDate(c.due_date)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">
                    {c.xero_invoice_number ?? (
                      <span className="text-[color:var(--text-tertiary)]">
                        {c.status === "scheduled" ? `on ${fmtDate(c.scheduled_generation_date)}` : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill tone={s.tone}>{s.label}</StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{formatZAR(c.amount_zar)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono">
                    {c.amount_paid_zar > 0 ? formatZAR(c.amount_paid_zar) : "—"}
                    {c.paid_at && c.status === "paid" && (
                      <span className="block text-[10px] text-[color:var(--text-secondary)]">{fmtDate(c.paid_at)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
