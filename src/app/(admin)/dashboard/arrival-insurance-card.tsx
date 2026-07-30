"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ShieldAlert, UserX } from "lucide-react";
import { WidgetShell, WidgetEmpty } from "./widget-shell";
import type { ArrivalAlert } from "@/app/api/dashboard/arrival-insurance/route";

const KIND_STYLE: Record<
  ArrivalAlert["kind"],
  { label: string; detail: string; bg: string; fg: string; border: string }
> = {
  no_profile: {
    label: "No profile",
    detail: "Hasn't started a profile yet",
    bg: "hsl(0 70% 16%)",
    fg: "hsl(0 84% 72%)",
    border: "hsl(0 84% 60% / 0.4)",
  },
  insurance_missing: {
    label: "No insurance",
    detail: "No health insurance on file",
    bg: "hsl(0 70% 16%)",
    fg: "hsl(0 84% 72%)",
    border: "hsl(0 84% 60% / 0.4)",
  },
  insurance_expired: {
    label: "Expired",
    detail: "Health insurance has expired",
    bg: "hsl(28 80% 16%)",
    fg: "hsl(28 95% 65%)",
    border: "hsl(28 95% 55% / 0.4)",
  },
};

export function ArrivalInsuranceCard() {
  const [alerts, setAlerts] = useState<ArrivalAlert[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/arrival-insurance", {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as { alerts: ArrivalAlert[] };
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
      <WidgetShell title="Arrival — profile & insurance">
        <WidgetEmpty>Loading…</WidgetEmpty>
      </WidgetShell>
    );
  }

  if (alerts.length === 0) {
    return (
      <WidgetShell title="Arrival — profile & insurance">
        <WidgetEmpty>
          Every arriving student has a profile and valid insurance.
        </WidgetEmpty>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell title="Arrival — profile & insurance">
      <div>
        {alerts.map((a) => {
          const s = KIND_STYLE[a.kind];
          const Icon = a.kind === "no_profile" ? UserX : ShieldAlert;
          return (
            <Link
              key={`${a.userId}:${a.programId}:${a.kind}`}
              href={`/schools/${a.programId}?tab=arrival`}
              className="flex items-center justify-between transition-colors duration-150"
              style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid hsl(22 8% 11%)" }}
            >
              <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                <Icon className="h-4 w-4" style={{ color: s.fg, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "#F0EBE3" }} className="truncate">
                    {a.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "hsl(30 8% 42%)", marginTop: "2px" }} className="truncate">
                    {a.programName} · {s.detail}
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
                    borderRadius: "999px",
                    background: s.bg,
                    color: s.fg,
                    border: `1px solid ${s.border}`,
                  }}
                >
                  {s.label}
                </span>
                <ArrowUpRight className="h-3 w-3" style={{ color: "hsl(42 95% 55%)" }} />
              </div>
            </Link>
          );
        })}
      </div>
    </WidgetShell>
  );
}
