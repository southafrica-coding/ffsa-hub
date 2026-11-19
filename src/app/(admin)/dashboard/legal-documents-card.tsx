"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { URGENCY_COLOUR, type ReminderLine } from "@/lib/legal/reminders";
import { WidgetEmpty, WidgetShell } from "./widget-shell";

type Data = {
  counts: { expired: number; renewNow: number; missing: number; applicationsPressing: number };
  lines: ReminderLine[];
  more: number;
};

// Not a band: the dashboard's one yellow band is staff approvals. This card
// carries the same lines as the 07:00 email.
export function LegalDocumentsCard() {
  const [data, setData] = useState<Data | null | "hidden">(null);

  useEffect(() => {
    let live = true;
    fetch("/api/dashboard/legal-documents", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 403) return setData("hidden");
        setData(res.ok ? ((await res.json()) as Data) : "hidden");
      })
      .catch(() => live && setData("hidden"));
    return () => {
      live = false;
    };
  }, []);

  // Not on the list, or the tables aren't there yet: show nothing.
  if (data === "hidden") return null;

  return (
    <WidgetShell title="Legal papers" href="/legal-documents" hrefLabel="Open">
      {data === null ? (
        <WidgetEmpty>Loading…</WidgetEmpty>
      ) : data.lines.length === 0 ? (
        <WidgetEmpty>Nothing has expired or needs renewing.</WidgetEmpty>
      ) : (
        <>
          <div className="grid grid-cols-3 border-b border-rule">
            {[
              { label: "Expired", n: data.counts.expired },
              { label: "Renew now", n: data.counts.renewNow },
              { label: "Applications", n: data.counts.applicationsPressing },
            ].map((k) => (
              <div key={k.label} className="border-r border-rule px-4 py-3 last:border-r-0">
                <div className="mono-label mb-1">{k.label}</div>
                <div className="numeral text-[30px]">{k.n}</div>
              </div>
            ))}
          </div>
          <ul>
            {data.lines.map((l) => (
              <li key={`${l.kind}:${l.id}`}>
                <Link
                  href="/legal-documents"
                  style={l.urgency ? { boxShadow: `inset 4px 0 0 ${URGENCY_COLOUR[l.urgency].bg}` } : undefined}
                  className="flex min-h-[52px] items-center justify-between gap-3 border-b border-rule px-5 py-2.5 hover:bg-bone"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-ink">{l.title}</span>
                    <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                      {l.folder}
                      {l.kind === "application" ? " · application" : ""}
                    </span>
                  </span>
                  <span
                    className="shrink-0 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em]"
                    style={
                      l.urgency
                        ? { background: URGENCY_COLOUR[l.urgency].bg, color: URGENCY_COLOUR[l.urgency].fg }
                        : { border: "1px solid var(--rule-strong)", color: "var(--text-secondary)" }
                    }
                  >
                    {l.when.replace(/ \(.*\)$/, "")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data.more > 0 && (
            <p className="px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
              And {data.more} more
            </p>
          )}
        </>
      )}
    </WidgetShell>
  );
}
