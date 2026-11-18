"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import { WidgetShell, WidgetEmpty } from "./widget-shell";

type Alert = {
  userId: string;
  name: string;
  ministryId: string;
  ministryName: string;
  state: "missing" | "expired" | "expiring";
  expiryDate: string | null;
  daysLeft: number | null;
};

const STATE_STYLE: Record<
  Alert["state"],
  { label: string; bg: string; fg: string; border: string }
> = {
  expired: { label: "Expired", bg: "hsl(0 70% 16%)", fg: "hsl(0 84% 72%)", border: "hsl(0 84% 60% / 0.4)" },
  missing: { label: "Missing", bg: "hsl(0 70% 16%)", fg: "hsl(0 84% 72%)", border: "hsl(0 84% 60% / 0.4)" },
  expiring: { label: "Expiring", bg: "var(--yellow-dim)", fg: "var(--amber)", border: "var(--amber-border)" },
};

function detail(a: Alert): string {
  if (a.state === "missing") return "No policy on file";
  const date = a.expiryDate
    ? new Date(a.expiryDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : "";
  if (a.state === "expired") {
    const ago = a.daysLeft != null ? Math.abs(a.daysLeft) : null;
    // A mistyped year ("0028" for "2028") reads as ~2000 years overdue and
    // buries the genuine alerts beside it. Same guard as the notification feed.
    if (ago != null && ago > 3650) return `Expiry date looks wrong · ${date}`;
    return ago != null ? `Expired ${ago === 1 ? "yesterday" : `${ago} days ago`} · ${date}` : `Expired · ${date}`;
  }
  const left = a.daysLeft ?? 0;
  return `Expires ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`} · ${date}`;
}

export function StaffInsuranceCard() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/staff-insurance", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { alerts: Alert[] };
          setAlerts(json.alerts ?? []);
        } else {
          setAlerts([]);
        }
      } catch {
        setAlerts([]);
      }
    })();
  }, []);

  if (alerts === null) {
    return (
      <WidgetShell title="Staff insurance">
        <WidgetEmpty>Loading…</WidgetEmpty>
      </WidgetShell>
    );
  }

  if (alerts.length === 0) {
    return (
      <WidgetShell title="Staff insurance">
        <WidgetEmpty>All staff insurance is current.</WidgetEmpty>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title="Staff insurance">
      <div>
        {alerts.map((a) => {
          const s = STATE_STYLE[a.state];
          return (
            <Link
              key={`${a.userId}:${a.ministryId}`}
              href={`/ministry/${a.ministryId}`}
              className="flex items-center justify-between transition-colors duration-150"
              style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid var(--surface-2)" }}
            >
              <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                <ShieldAlert className="h-4 w-4" style={{ color: s.fg, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }} className="truncate">
                    {a.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }} className="truncate">
                    {a.ministryName} · {detail(a)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: 0,
                    background: s.bg,
                    color: s.fg,
                    border: `1px solid ${s.border}`,
                  }}
                >
                  {s.label}
                </span>
                <ArrowUpRight className="h-3 w-3" style={{ color: "var(--ink)" }} />
              </div>
            </Link>
          );
        })}
      </div>
    </WidgetShell>
  );
}
