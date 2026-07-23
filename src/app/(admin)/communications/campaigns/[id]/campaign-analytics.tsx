import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-xl font-bold mt-0.5">{m.value}</p>
              {m.sub && (
                <p className="text-xs text-muted-foreground mt-0.5">{m.sub}</p>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Open and click rates update as Mailtrap delivers webhook events.
        </p>
      </CardContent>
    </Card>
  );
}
