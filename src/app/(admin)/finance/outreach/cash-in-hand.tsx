import { Bar } from "@/components/ffsa";
import {
  cashInHand,
  daysLeft,
  recentDailySpend,
  spentFromSent,
  type CashExpense,
  type CashLevel,
} from "@/lib/finance/outreach-cash";
import { sastDate } from "@/lib/slack/assistant/outreach";

const zar = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

export const LEVEL_COLOUR: Record<CashLevel, string | undefined> = {
  none: undefined,
  ok: undefined,
  low: "var(--amber-border)",
  critical: "hsl(var(--destructive))",
};

const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Money sent to the team vs what they've spent of it — the figure school
 * leaders at base watch to know when to send more (see outreach-cash.ts).
 */
export function CashInHand({
  releases,
  expenses,
  lowPct,
  criticalPct,
}: {
  releases: { amount_zar: number | string; release_date: string | null }[];
  expenses: CashExpense[];
  lowPct?: number | null;
  criticalPct?: number | null;
}) {
  const sent = releases.reduce((s, r) => s + Number(r.amount_zar), 0);
  const c = cashInHand({ sent, spent: spentFromSent(expenses), lowPct, criticalPct });
  const today = sastDate(new Date());
  const perDay = recentDailySpend(expenses, today);
  const days = daysLeft(c.left, perDay);
  const lastSent = releases
    .map((r) => r.release_date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  const colour = LEVEL_COLOUR[c.level];

  return (
    <section className="border border-ink">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 pt-4">
        <h3 className="mono-label">Money sent to the team</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12.5px] tabular-nums">
          <span>
            <span className="text-[#7C786C]">Sent </span>
            {zar(c.sent)}
          </span>
          <span>
            <span className="text-[#7C786C]">Spent </span>
            {zar(c.spent)}
          </span>
        </div>
      </div>

      <div className="px-5 pb-4 pt-3">
        {c.level === "none" ? (
          <p className="text-sm text-muted-foreground">No money has been sent to the team yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="numeral text-[30px] leading-none" style={{ color: colour }}>
                {c.left < 0 ? `−${zar(-c.left)}` : zar(c.left)}
              </span>
              <span className="text-sm" style={{ color: colour }}>
                {c.left < 0
                  ? "spent more than was sent"
                  : `still with the team (${Math.max(0, c.pctLeft ?? 0).toFixed(0)}% of what was sent)`}
              </span>
            </div>
            <div className="mt-3">
              <Bar pct={c.pctSpent ?? 0} tone={colour} />
            </div>
            <p className="mt-2 font-mono text-[11px] text-[#55524A]">
              {[
                lastSent && `Last sent ${shortDate(lastSent)}`,
                perDay > 0
                  ? `spending about ${zar(perDay)}/day this week` +
                    (days != null && c.left > 0 ? ` — lasts about ${days} more day${days === 1 ? "" : "s"}` : "")
                  : "no spending in the last 7 days",
                c.level === "critical" && c.left >= 0 ? "time to send more" : null,
                c.level === "low" ? "send more soon" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
