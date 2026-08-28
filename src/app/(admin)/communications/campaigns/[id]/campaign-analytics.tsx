import { SectionBar } from "@/components/ffsa";
import type { CampaignStats } from "@/services/campaigns";

function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export function CampaignAnalytics({ stats }: { stats: CampaignStats }) {
  const metrics = [
    { label: "Sent", value: stats.sent.toLocaleString(), sub: null },
    {
      label: "Delivered",
      value: stats.delivered.toLocaleString(),
      sub: pct(stats.delivered, stats.sent),
    },
    {
      label: "Opened",
      value: stats.opened.toLocaleString(),
      sub: pct(stats.opened, stats.delivered),
    },
    {
      label: "Clicked",
      value: stats.clicked.toLocaleString(),
      sub: pct(stats.clicked, stats.delivered),
    },
    {
      label: "Bounced",
      value: stats.bounced.toLocaleString(),
      sub: pct(stats.bounced, stats.sent),
    },
    {
      label: "Unsubscribed",
      value: stats.unsubscribed.toLocaleString(),
      sub: pct(stats.unsubscribed, stats.delivered),
    },
  ];

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Email performance" meta="Live from webhook events" />
      {/* Six cells, so the strip steps 2 → 3 → 6 rather than using KpiStrip's
          four-up grid — the numerals stay legible on a phone. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="kpi border-b border-rule">
            <div className="mono-label mb-2.5">{m.label}</div>
            <span className="numeral text-[38px]">{m.value}</span>
            {m.sub && (
              <div className="tabular mt-2 font-mono text-[10px] tracking-[0.08em] text-[color:var(--text-secondary)]">
                {m.sub}
              </div>
            )}
          </div>
        ))}
      </div>
      {stats.sent > 0 &&
      stats.delivered === 0 &&
      stats.bounced === 0 &&
      stats.opened === 0 ? (
        // Every counter here comes from Mailtrap webhooks. Sent mail with no
        // event of ANY kind means the webhook isn't reaching us — say so,
        // rather than showing zeros that read as "nobody got it".
        <p className="px-5 py-3 text-[11px] text-amber-600 dark:text-amber-400">
          No delivery events have arrived for this send. The email was accepted
          by Mailtrap, but these counters stay at zero until Mailtrap’s webhook
          can reach the Hub — check the webhook URL in Mailtrap (it must
          include the <span className="font-mono">?token=</span> query and
          point at the www domain).
        </p>
      ) : (
        <p className="px-5 py-3 text-[11px] text-[color:var(--text-tertiary)]">
          Open and click rates update as Mailtrap delivers webhook events.
        </p>
      )}
    </div>
  );
}
